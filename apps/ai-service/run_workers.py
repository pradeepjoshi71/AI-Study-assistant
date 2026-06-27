import asyncio
import logging
import sys
from app.worker import run_worker
from app.embedding_worker import run_embedding_worker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker_process")

async def main():
    logger.info("Starting isolated BullMQ workers...")
    try:
        await asyncio.gather(
            run_worker(),
            run_embedding_worker()
        )
    except KeyboardInterrupt:
        logger.info("Workers stopped by user interrupt.")
        sys.exit(0)
    except Exception as e:
        logger.critical(f"Workers terminated due to error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
