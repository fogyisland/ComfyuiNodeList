import ast
import re
import sys
import tomllib
from typing import Any

if sys.version_info >= (3, 11):
    pass  # tomllib is in stdlib
else:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]

from packaging.requirements import InvalidRequirement, Requirement


def _empty() -> dict[str, Any]:
    return {
        "python_min": None,
        "python_max": None,
        "dependencies": [],
        "node_class_mappings": [],
        "incompatibilities": [],
        "scan_warnings": [],
        "raw_files": {},
    }


def _parse_python_spec(spec: str) -> tuple[str | None, str | None]:
    """Parse a `requires-python` string like '>=3.10,<3.13' into (min, max)."""
    if not spec:
        return None, None
    py_min: str | None = None
    py_max: str | None = None
    for part in spec.split(","):
        part = part.strip()
        m = re.match(r"^(>=|>|==|~=)?\s*(\d+\.\d+)", part)
        if not m:
            continue
        op, ver = m.group(1) or ">=", m.group(2)
        if op in (">=", ">", "==", "~="):
            if py_min is None or _ver_tuple(ver) > _ver_tuple(py_min):
                py_min = ver
        if op in ("<=", "<"):
            if py_max is None or _ver_tuple(ver) < _ver_tuple(py_max):
                py_max = ver
    return py_min, py_max


def _ver_tuple(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split(".") if x.isdigit())


def _req_to_dict(req: Requirement) -> dict[str, Any]:
    """Convert a packaging.Requirement to the {name, spec, min_version, max_version, is_pinned} shape."""
    spec_str = str(req.specifier) if req.specifier else ""
    is_pinned = "==" in spec_str and "," not in spec_str
    min_v: str | None = None
    max_v: str | None = None
    for s in req.specifier:
        v = s.version
        if s.operator in (">=", ">", "==", "~="):
            if min_v is None or _ver_tuple(v) > _ver_tuple(min_v):
                min_v = v
        if s.operator in ("<=", "<"):
            if max_v is None or _ver_tuple(v) < _ver_tuple(max_v):
                max_v = v
    return {
        "name": req.name,
        "spec": f"{req.name}{spec_str}",
        "min_version": min_v,
        "max_version": max_v,
        "is_pinned": is_pinned,
    }


def parse_pyproject_toml(filename: str, content: str) -> dict[str, Any]:
    out = _empty()
    try:
        data = tomllib.loads(content)
    except Exception as e:
        out["scan_warnings"].append(f"{filename}: invalid TOML: {e}")
        return out
    project = data.get("project", {})
    py_min, py_max = _parse_python_spec(project.get("requires-python", ""))
    out["python_min"] = py_min
    out["python_max"] = py_max
    for dep_str in project.get("dependencies", []):
        try:
            req = Requirement(dep_str)
            out["dependencies"].append(_req_to_dict(req))
        except InvalidRequirement as e:
            out["scan_warnings"].append(f"{filename}: invalid dep '{dep_str}': {e}")
    out["raw_files"][filename] = content
    return out


_REQ_LINE_RE = re.compile(r"^\s*([A-Za-z0-9_.\-]+)")


def parse_requirements_txt(filename: str, content: str) -> dict[str, Any]:
    out = _empty()
    out["raw_files"][filename] = content
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-") or line.startswith("--"):
            continue  # skip -r, -c, --index-url, etc.
        try:
            req = Requirement(line)
            out["dependencies"].append(_req_to_dict(req))
        except InvalidRequirement as e:
            out["scan_warnings"].append(f"{filename}: invalid line '{line}': {e}")
    return out


_PIP_INSTALL_RE = re.compile(r"pip[3]?\s+install\s+([^\"'#]+)")
_QUOTED_RE = re.compile(r"['\"]([A-Za-z0-9_.\-]+)\s*([<>=!~]+\s*[^'\"]+)?['\"]")


def parse_install_py(filename: str, content: str) -> dict[str, Any]:
    out = _empty()
    out["raw_files"][filename] = content
    # Find pip install commands in strings (os.system, subprocess.check_call, etc.)
    # Strategy: find any string literal that contains "pip install", then extract package specs.
    try:
        tree = ast.parse(content)
    except SyntaxError as e:
        out["scan_warnings"].append(f"{filename}: syntax error: {e}")
        return out
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            # check_call/check_call(args=[...])
            if isinstance(node.func, ast.Attribute) and node.func.attr in ("check_call", "run", "call"):
                for arg in node.args:
                    if isinstance(arg, (ast.List, ast.Tuple)):
                        for elt in arg.elts:
                            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                _extract_pip_specs(elt.value, out)
            # os.system("pip install ...")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "system":
            for arg in node.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    _extract_pip_specs(arg.value, out)
    return out


def _extract_pip_specs(command_str: str, out: dict[str, Any]) -> None:
    m = _PIP_INSTALL_RE.search(command_str)
    if not m:
        return
    payload = m.group(1)
    # Split on whitespace; each token is a package spec like "torch>=2.0.0" or "--upgrade" or quoted.
    for token in re.findall(r"['\"]?([A-Za-z0-9_.\-]+\s*[<>=!~]+\s*[A-Za-z0-9_.\-]+)['\"]?", payload):
        token = token.strip()
        if not token:
            continue
        try:
            req = Requirement(token)
            out["dependencies"].append(_req_to_dict(req))
        except InvalidRequirement:
            out["scan_warnings"].append(f"install.py: invalid spec '{token}'")


_NODE_CLASS_RE = re.compile(r"NODE_CLASS_MAPPINGS\s*=\s*\{([^}]*)\}", re.DOTALL)


def parse_node_class_mappings(filename: str, content: str) -> dict[str, Any]:
    out = _empty()
    out["raw_files"][filename] = content
    m = _NODE_CLASS_RE.search(content)
    if not m:
        return out
    body = m.group(1)
    # Extract keys: 'KeyName': or "KeyName":
    for key in re.findall(r"['\"]([^'\"]+)['\"]\s*:", body):
        if key not in out["node_class_mappings"]:
            out["node_class_mappings"].append(key)
    return out


_INCOMPAT_RE = re.compile(
    r"(?:incompatible\s+with|conflicts?\s+with|not\s+compatible\s+with|do\s+not\s+install\s+with)[:\s]+([^\n.]+)",
    re.IGNORECASE,
)


def parse_readme_incompatibilities(filename: str, content: str) -> dict[str, Any]:
    out = _empty()
    out["raw_files"][filename] = content
    for m in _INCOMPAT_RE.finditer(content):
        payload = m.group(1)
        # Tokenize: split on commas / "and" / whitespace
        for token in re.split(r"[,;]|\s+and\s+", payload):
            name = token.strip().strip("`*_").strip()
            # Normalize: drop trailing punctuation, drop "node" / "nodes" suffix
            name = name.rstrip(".,;")
            name = re.sub(r"\s+nodes?$", "", name, flags=re.IGNORECASE).strip()
            # Drop generic words
            if not name or name.lower() in {"other", "this", "these", "all", "any"}:
                continue
            if name not in out["incompatibilities"]:
                out["incompatibilities"].append(name)
    return out


def _merge(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    for dep in extra.get("dependencies", []):
        if dep not in base["dependencies"]:
            base["dependencies"].append(dep)
    for cls in extra.get("node_class_mappings", []):
        if cls not in base["node_class_mappings"]:
            base["node_class_mappings"].append(cls)
    for inc in extra.get("incompatibilities", []):
        if inc not in base["incompatibilities"]:
            base["incompatibilities"].append(inc)
    base["scan_warnings"].extend(extra.get("scan_warnings", []))
    base["raw_files"].update(extra.get("raw_files", {}))
    # python_min/python_max: take the first non-None (pyproject.toml is the canonical source)
    if base["python_min"] is None:
        base["python_min"] = extra.get("python_min")
    if base["python_max"] is None:
        base["python_max"] = extra.get("python_max")
    return base


def parse_version_files(files: dict[str, str]) -> dict[str, Any]:
    """Pipeline: run all 5 parsers on their respective file contents and merge."""
    out = _empty()
    if "pyproject.toml" in files:
        _merge(out, parse_pyproject_toml("pyproject.toml", files["pyproject.toml"]))
    if "requirements.txt" in files:
        _merge(out, parse_requirements_txt("requirements.txt", files["requirements.txt"]))
    if "install.py" in files:
        _merge(out, parse_install_py("install.py", files["install.py"]))
    # __init__.py and nodes.py: take whichever exists
    for fname in ("__init__.py", "nodes.py"):
        if fname in files:
            _merge(out, parse_node_class_mappings(fname, files[fname]))
    if "README.md" in files:
        _merge(out, parse_readme_incompatibilities("README.md", files["README.md"]))
    return out
