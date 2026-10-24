"""流水线运行参数集中配置。

所有可调参数只在本文件维护，各模块统一引用本文件，不在各自代码里写死；
CLI 参数可临时覆盖对应值。
注意：抽取进程数 × 单进程 OCR 线程数 ≈ 峰值 CPU 占用，调大前先确认机器核心数。
"""

# ---------- 爬虫（官方站抓取与 PDF 下载） ----------

# 下载一分一段 PDF 的线程池大小；1 = 保持顺序下载
DOWNLOAD_WORKERS = 6

# 官方站请求超时（秒）：爬虫与转换流程的联网步骤共用
REQUEST_TIMEOUT = 60

# 官方站 WAF 自动引导：首次 403/412 时用 DrissionPage 驱动真实浏览器过挑战
# （需要 pip install DrissionPage，本机需装 Chrome 或 Edge；False = 只靠手动 .waf-cookie）
WAF_AUTO_BOOTSTRAP = True


# ---------- OCR（一分一段扫描 PDF 抽取） ----------

# OCR 进程池大小：convert_all --workers 的默认值，ingest_year 一并读取
SCORE_SEGMENT_WORKERS = 8

# 单个 OCR 进程内 onnxruntime 线程数（intra_op / inter_op），仅 CPU 计算时生效
OCR_INTRA_OP_THREADS = 2
OCR_INTER_OP_THREADS = 1

# RapidOCR 引擎日志级别
OCR_LOG_LEVEL = 'warning'

# OCR 计算设备：'cpu' / 'cuda' / 'dml'
#   cpu  —— 默认，无需额外依赖
#   cuda —— NVIDIA 显卡：pip install onnxruntime-gpu，并自备 CUDA 12.x + cuDNN 9.x
#   dml  —— Windows 任意 DX12 显卡（含 4060）：pip install onnxruntime-directml
# 注意：多进程时每个进程独占一份显存上下文（约 1–1.5GB），8GB 显存建议不超过 4 个进程
OCR_DEVICE = 'cpu'
OCR_GPU_DEVICE_ID = 0


def ocr_engine_params() -> dict:
    """组装 RapidOCR 引擎参数，pdf_tables 不再自行维护配置。"""
    params = {
        'Global.log_level': OCR_LOG_LEVEL,
        'EngineConfig.onnxruntime.intra_op_num_threads': OCR_INTRA_OP_THREADS,
        'EngineConfig.onnxruntime.inter_op_num_threads': OCR_INTER_OP_THREADS,
    }
    if OCR_DEVICE == 'cuda':
        params['EngineConfig.onnxruntime.use_cuda'] = True
        params['EngineConfig.onnxruntime.cuda_ep_cfg'] = {'device_id': OCR_GPU_DEVICE_ID}
    elif OCR_DEVICE == 'dml':
        params['EngineConfig.onnxruntime.use_dml'] = True
    elif OCR_DEVICE != 'cpu':
        raise ValueError(f"OCR_DEVICE 仅支持 'cpu' / 'cuda' / 'dml'，当前为 {OCR_DEVICE!r}")
    return params
