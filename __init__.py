from .nodes.dynamic_sigma_scheduler import DynamicSigmaScheduler
from .nodes.concat_sigmas import ConcatSigmas
from .nodes.graph_sigmas import GraphSigmas
from .nodes.sigmas_to_scheduler_func import SigmasToSchedulerFunc

__version__ = "1.1.0"

NODE_CLASS_MAPPINGS = {
    "DynamicSigmaScheduler": DynamicSigmaScheduler,
    "ConcatSigmas": ConcatSigmas,
    "GraphSigmas": GraphSigmas,
    "Cozdx1SigmasToSchedulerFunc": SigmasToSchedulerFunc,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DynamicSigmaScheduler": "[cozdx1] Dynamic Sigma Scheduler",
    "ConcatSigmas": "[cozdx1] Concat Sigmas",
    "GraphSigmas": "[cozdx1] Graph Sigmas",
    "Cozdx1SigmasToSchedulerFunc": "[cozdx1] Sigmas to Scheduler Func",
}

WEB_DIRECTORY = "./web/js"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
    "__version__",
]
