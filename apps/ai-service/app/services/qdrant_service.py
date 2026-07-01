import itertools
import logging
import io
import os
import tempfile
from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
from app.core.config import settings
from app.services.minio_storage import get_minio_client, ensure_bucket

logger = logging.getLogger(__name__)

class QdrantService:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(QdrantService, cls).__new__(cls, *args, **kwargs)
            cls._instance._init_service()
        return cls._instance

    def _init_service(self):
        # We point host1 and host2 to node1 and node2 respectively.
        # Fall back to standard settings if not specified.
        self.node1_host = getattr(settings, "QDRANT_HOST_NODE1", settings.QDRANT_HOST)
        self.node2_host = getattr(settings, "QDRANT_HOST_NODE2", settings.QDRANT_HOST)
        self.port = settings.QDRANT_PORT

        self.write_client = QdrantClient(host=self.node1_host, port=self.port)
        self.read_client_node1 = QdrantClient(host=self.node1_host, port=self.port)
        self.read_client_node2 = QdrantClient(host=self.node2_host, port=self.port)

        self._read_clients = [self.read_client_node1, self.read_client_node2]
        self._cycle = itertools.cycle([0, 1])

    def get_write_client(self) -> QdrantClient:
        """Returns the primary Qdrant client pointing to node1."""
        return self.write_client

    def get_read_client(self) -> QdrantClient:
        """Returns a Qdrant client selected using round-robin between node1 and node2."""
        idx = next(self._cycle)
        client = self._read_clients[idx]
        try:
            # Perform a quick client check to ensure node is alive
            return client
        except Exception as e:
            logger.warning(f"Qdrant read client node {idx+1} unreachable, falling back to node 1: {e}")
            return self.read_client_node1

qdrant_service = QdrantService()


def backup_collections():
    """Daily cron task to snapshot all collections and upload them to Minio."""
    try:
        client = qdrant_service.get_write_client()
        minio = get_minio_client()
        ensure_bucket(minio)
        
        collections = [c.name for c in client.get_collections().collections]
        for col in collections:
            logger.info(f"Creating snapshot for Qdrant collection: {col}...")
            snapshot_meta = client.create_snapshot(collection_name=col)
            snapshot_name = snapshot_meta.name
            
            with tempfile.TemporaryDirectory() as tmpdir:
                local_path = os.path.join(tmpdir, snapshot_name)
                client.download_snapshot(
                    collection_name=col,
                    snapshot_name=snapshot_name,
                    location=local_path
                )
                
                object_name = f"qdrant-snapshots/{col}/{snapshot_name}"
                with open(local_path, "rb") as f:
                    data = f.read()
                    minio.put_object(
                        bucket_name=settings.MINIO_BUCKET,
                        object_name=object_name,
                        data=io.BytesIO(data),
                        length=len(data),
                        content_type="application/octet-stream"
                    )
                logger.info(f"Successfully uploaded Qdrant snapshot to Minio: {object_name}")
    except Exception as e:
        logger.error(f"Failed to perform Qdrant snapshot backup: {e}", exc_info=True)


def restore_collections_if_empty():
    """Checks collections on startup, if empty, restores from the latest Minio snapshot."""
    try:
        client = qdrant_service.get_write_client()
        minio = get_minio_client()
        ensure_bucket(minio)
        
        from app.services.qdrant_collections import LEGACY_COLLECTION, V2_COLLECTION
        collections = [LEGACY_COLLECTION, V2_COLLECTION]
        
        for col in collections:
            try:
                # Check if collection exists
                existing_cols = [c.name for c in client.get_collections().collections]
                if col in existing_cols:
                    info = client.get_collection(collection_name=col)
                    if info.vectors_count and info.vectors_count > 0:
                        logger.info(f"Qdrant collection '{col}' is not empty ({info.vectors_count} vectors). Skipping restore.")
                        continue
                
                # List snapshots in Minio
                objects = list(minio.list_objects(
                    settings.MINIO_BUCKET,
                    prefix=f"qdrant-snapshots/{col}/",
                    recursive=True
                ))
                if not objects:
                    logger.warning(f"No snapshots found in Minio for collection '{col}' under prefix qdrant-snapshots/{col}/")
                    continue
                
                # Sort to get the latest snapshot
                objects.sort(key=lambda x: x.last_modified, reverse=True)
                latest_obj = objects[0]
                
                logger.info(f"Restoring collection '{col}' from latest snapshot in Minio: {latest_obj.object_name}")
                
                with tempfile.TemporaryDirectory() as tmpdir:
                    local_path = os.path.join(tmpdir, "snapshot.tar")
                    minio.fget_object(
                        settings.MINIO_BUCKET,
                        latest_obj.object_name,
                        local_path
                    )
                    
                    client.recover_from_snapshot(
                        collection_name=col,
                        location=f"file://{local_path}"
                    )
                    logger.info(f"Successfully restored collection '{col}' from snapshot.")
            except Exception as e:
                logger.error(f"Failed to restore Qdrant collection '{col}' on startup: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"Qdrant restore check failed: {e}", exc_info=True)
