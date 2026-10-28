"""Python 数据流水线的共享运行默认值。

网络和 OCR 的通用默认值集中在本文件，CLI 可临时覆盖明确支持的参数。
部署相关设置（如 WAF_BROWSER_PATH、WAF_HEADLESS）通过环境变量提供，工作流维护其运行环境取值。
注意：抽取进程数 × 单进程 OCR 线程数 ≈ 峰值 CPU 占用，调大前先确认机器核心数。
"""

# ---------- 爬虫（官方站抓取与 PDF 下载） ----------

# 官方站下载共享一个 WAF 会话；默认串行，避免并发触发挑战或竞争会话状态。
# 可由 download_manifest(..., workers=N) 在确认来源允许并发时临时覆盖。
DOWNLOAD_WORKERS = 1

# 官方站请求超时（秒）：爬虫与转换流程的联网步骤共用
REQUEST_TIMEOUT = 60

# 官方站 WAF 自动引导：首次 400/403/412 时用 DrissionPage 驱动真实浏览器过挑战
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
    """组装分数段和扫描表格共用的 RapidOCR 引擎参数。"""
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
