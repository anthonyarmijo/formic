"""
Formic Workspaces API

Thin wrapper around the folder system that adds workspace/project-group semantics.
A workspace is a folder with conventions for project_path, group_type, and tags
stored in the folder's data JSON column.

Namespaced under /api/v1/workspaces to avoid collision with the existing
/api/v1/groups router (which handles user/RBAC groups, not project workspaces).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from open_webui.constants import ERROR_MESSAGES
from open_webui.internal.db import get_async_session
from open_webui.models.chats import Chats
from open_webui.models.folders import (
    FolderForm,
    FolderModel,
    Folders,
    FolderUpdateForm,
)
from open_webui.utils.access_control import has_permission
from open_webui.utils.access_control.files import get_accessible_folder_files
from open_webui.utils.auth import get_verified_user
from open_webui.utils.group_context import (
    build_formic_context_bundle,
    normalize_folder_project_path_data,
)
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

router = APIRouter()

# ── Workspace data conventions ──────────────────────────────────────────
# These keys live inside folder.data (JSON).  The backend does not enforce
# a schema — the frontend is responsible for keeping the values consistent.
#
#   data.project_path : str | None    absolute path on the host filesystem
#   data.group_type   : str           "project" | "topic" | "scratch"
#   data.tags         : list[str]     user-defined tags for filtering
#   data.workspace    : str | None    top-level area ("personal", "work", …)
# ────────────────────────────────────────────────────────────────────────


def normalize_workspace_form_project_path(
    form_data: FolderForm | FolderUpdateForm,
) -> FolderForm | FolderUpdateForm:
    if not form_data.data:
        return form_data

    try:
        data = normalize_folder_project_path_data(form_data.data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.DEFAULT(str(e)),
        ) from e

    return form_data.model_copy(update={"data": data})


############################
# Get Workspaces
############################

@router.get("/", response_model=list[FolderModel])
async def get_workspaces(
    request: Request,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Return all workspaces (folders) for the current user.

    Query params (optional):
        type      — filter by group_type  (e.g. ?type=project)
        has_path  — if "true", only workspaces with project_path set
        tag       — filter by tag         (e.g. ?tag=python)
        workspace — filter by area        (e.g. ?workspace=personal)
    """
    if request.app.state.config.ENABLE_FOLDERS is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    if user.role != "admin" and not await has_permission(
        user.id,
        "features.folders",
        request.app.state.config.USER_PERMISSIONS,
        db=db,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    folders = await Folders.get_folders_by_user_id(user.id, db=db)

    # Client-side filtering for workspace-specific fields stored in data JSON.
    # (SQLite json_extract queries can be added later for server-side filtering.)
    filter_type = request.query_params.get("type")
    filter_has_path = request.query_params.get("has_path")
    filter_tag = request.query_params.get("tag")
    filter_workspace = request.query_params.get("workspace")

    result = []
    for folder in folders:
        data = folder.data or {}

        if filter_type and data.get("group_type") != filter_type:
            continue
        if filter_has_path and filter_has_path.lower() == "true":
            if not data.get("project_path"):
                continue
        if filter_tag:
            tags = data.get("tags", [])
            if filter_tag not in tags:
                continue
        if filter_workspace:
            if data.get("workspace") != filter_workspace:
                continue

        result.append(folder)

    return result


############################
# Create Workspace
############################

@router.post("/", response_model=FolderModel)
async def create_workspace(
    form_data: FolderForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a new workspace (folder)."""
    form_data = normalize_workspace_form_project_path(form_data)
    folder = await Folders.get_folder_by_parent_id_and_user_id_and_name(
        form_data.parent_id, user.id, form_data.name, db=db
    )

    if folder:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.DEFAULT("Workspace already exists"),
        )

    try:
        folder = await Folders.insert_new_folder(
            user.id, form_data, form_data.parent_id, db=db
        )
        return folder
    except Exception as e:
        log.exception(e)
        log.error("Error creating workspace")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.DEFAULT("Error creating workspace"),
        )


############################
# Get Workspace Context
############################

@router.get("/{id}/context")
async def get_workspace_context(
    request: Request,
    id: str,
    chat_id: str | None = None,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Return computed Formic context metadata without writing it to a chat."""
    if request.app.state.config.ENABLE_FOLDERS is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    if user.role != "admin" and not await has_permission(
        user.id,
        "features.folders",
        request.app.state.config.USER_PERMISSIONS,
        db=db,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    folder = await Folders.get_folder_by_id_and_user_id(id, user.id, db=db)
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    data = folder.data if isinstance(folder.data, dict) else {}
    folder_files = data.get("files") if isinstance(data.get("files"), list) else []
    file_refs = await get_accessible_folder_files(folder_files, user, db=db)

    return build_formic_context_bundle(
        folder=folder,
        user_id=user.id,
        chat_id=chat_id,
        file_refs=file_refs,
    )


############################
# Get Workspace By Id
############################

@router.get("/{id}", response_model=FolderModel)
async def get_workspace_by_id(
    id: str, user=Depends(get_verified_user), db: AsyncSession = Depends(get_async_session)
):
    """Get a single workspace by its id."""
    folder = await Folders.get_folder_by_id_and_user_id(id, user.id, db=db)
    if folder:
        return folder
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=ERROR_MESSAGES.NOT_FOUND,
    )


############################
# Update Workspace
############################

@router.post("/{id}/update", response_model=FolderModel)
async def update_workspace(
    id: str,
    form_data: FolderUpdateForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Update a workspace name and/or metadata."""
    form_data = normalize_workspace_form_project_path(form_data)
    folder = await Folders.get_folder_by_id_and_user_id(id, user.id, db=db)
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if form_data.name is not None:
        existing = await Folders.get_folder_by_parent_id_and_user_id_and_name(
            folder.parent_id, user.id, form_data.name, db=db
        )
        if existing and existing.id != id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ERROR_MESSAGES.DEFAULT("Workspace already exists"),
            )

    try:
        folder = await Folders.update_folder_by_id_and_user_id(
            id, user.id, form_data, db=db
        )
        return folder
    except Exception as e:
        log.exception(e)
        log.error(f"Error updating workspace: {id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.DEFAULT("Error updating workspace"),
        )


############################
# Delete Workspace
############################

@router.delete("/{id}")
async def delete_workspace(
    request: Request,
    id: str,
    delete_contents: bool = True,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a workspace and optionally its contents."""
    if await Chats.count_chats_by_folder_id_and_user_id(id, user.id, db=db):
        chat_delete_permission = await has_permission(
            user.id,
            "chat.delete",
            request.app.state.config.USER_PERMISSIONS,
            db=db,
        )
        if user.role != "admin" and not chat_delete_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
            )

    folders = []
    folders.append(await Folders.get_folder_by_id_and_user_id(id, user.id, db=db))
    while folders:
        folder = folders.pop()
        if folder:
            try:
                folder_ids = await Folders.delete_folder_by_id_and_user_id(
                    folder.id, user.id, db=db
                )
                for folder_id in folder_ids:
                    if delete_contents:
                        await Chats.delete_chats_by_user_id_and_folder_id(
                            user.id, folder_id, db=db
                        )
                    else:
                        await Chats.move_chats_by_user_id_and_folder_id(
                            user.id, folder_id, None, db=db
                        )
                return True
            except Exception as e:
                log.exception(e)
                log.error(f"Error deleting workspace: {id}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=ERROR_MESSAGES.DEFAULT("Error deleting workspace"),
                )
            finally:
                subfolders = await Folders.get_folders_by_parent_id_and_user_id(
                    folder.id, user.id, db=db
                )
                folders.extend(subfolders)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=ERROR_MESSAGES.NOT_FOUND,
    )
