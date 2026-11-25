import pathlib
import sys
import types

# The Home Assistant test plugin ships its own `custom_components` package that would shadow this
# repository's. Register one package that searches this repository first.
_repo = pathlib.Path(__file__).resolve().parents[1] / "custom_components"
_pkg = types.ModuleType("custom_components")
_pkg.__path__ = [str(_repo)]
sys.modules["custom_components"] = _pkg

pytest_plugins = ["pytest_homeassistant_custom_component"]
