import pytesseract
from PIL import Image
import logging

logger = logging.getLogger(__name__)

def perform_ocr(image_path: str) -> dict:
    """
    Performs OCR on an image and returns the extracted text and confidence scores.
    """
    try:
        # Check if tesseract binary is installed and reachable
        try:
            pytesseract.get_tesseract_version()
        except pytesseract.TesseractNotFoundError:
            logger.warning("Tesseract OCR binary not found. Running in Mock OCR Mode.")
            return {
                "text": "Mock OCR Text: This is a placeholder representing scanned image content for local testing.",
                "confidence": 0.99,
                "details": {
                    "word_count": 12,
                    "language": "eng",
                    "mocked": True
                }
            }

        logger.info(f"Performing OCR on image: {image_path}")
        image = Image.open(image_path)
        
        # Extract text
        text = pytesseract.image_to_string(image)
        
        # Calculate average confidence
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
        confidences = [int(conf) for conf in data['conf'] if conf not in ('-1', -1)]
        mean_confidence = sum(confidences) / len(confidences) if confidences else 0.0
        
        return {
            "text": text.strip(),
            "confidence": mean_confidence / 100.0,  # Normalize to 0.0 - 1.0 range
            "details": {
                "word_count": len(text.split()),
                "language": "eng",
                "mocked": False
            }
        }
    except Exception as err:
        logger.error(f"OCR failed for image {image_path}: {err}")
        raise err
