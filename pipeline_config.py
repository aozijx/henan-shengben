"""流水线运行参数集中配置。

所有可调参数只在本文件维护，各模块统一引用本文件，不在各自代码里写死；
CLI 参数可临时覆盖对应值。
注意：抽取进程数 × 单进程 OCR 线程数 ≈ 峰值 CPU 占用，调大前先确认机器核心数。
"""

# ---------- 爬虫（官方站抓取与 PDF 下载） ----------

# 下载一分一段 PDF 的线程池大小；1 = 保持顺序下载
DOWNLOAD_WORKERS = 1

# 官方站请求超时（秒）：爬虫与转换流程的联网步骤共用
REQUEST_TIMEOUT = 60

# 请求标识：便于官方站识别流量来源
USER_AGENT = 'henan-shengben-data/1.0'


# ---------- OCR（一分一段扫描 PDF 抽取） ----------

# OCR 进程池大小：convert_all --workers 的默认值，ingest_year 一并读取
SCORE_SEGMENT_WORKERS = 4

# 单个 OCR 进程内 onnxruntime 线程数（intra_op / inter_op）
OCR_INTRA_OP_THREADS = 2
OCR_INTER_OP_THREADS = 1

# RapidOCR 引擎日志级别
OCR_LOG_LEVEL = 'warning'


def ocr_engine_params() -> dict:
    """组装 RapidOCR 引擎参数，pdf_tables 不再自行维护配置。"""
    return {
        'Global.log_level': OCR_LOG_LEVEL,
        'EngineConfig.onnxruntime.intra_op_num_threads': OCR_INTRA_OP_THREADS,
        'EngineConfig.onnxruntime.inter_op_num_threads': OCR_INTER_OP_THREADS,
    }
