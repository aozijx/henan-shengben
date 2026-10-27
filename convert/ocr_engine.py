"""Create one RapidOCR engine per Python process when a scanned page needs it."""
from functools import cache

from pipeline_config import ocr_engine_params


@cache
def get_ocr_engine():
    try:
        from rapidocr import RapidOCR
    except ImportError as exc:
        raise RuntimeError("扫描 PDF 需要 rapidocr 和 onnxruntime；请安装 convert/requirements.txt") from exc
    return RapidOCR(params=ocr_engine_params())
