import pytest
from scanner.parsers import (
    parse_pyproject_toml,
    parse_requirements_txt,
    parse_install_py,
    parse_node_class_mappings,
    parse_readme_incompatibilities,
    parse_version_files,
)


# --- pyproject.toml ---

def test_parse_pyproject_extracts_dependencies():
    content = """
[project]
name = "my-node"
requires-python = ">=3.10,<3.13"
dependencies = [
    "torch>=2.0.0",
    "numpy==1.26.0",
]
"""
    result = parse_pyproject_toml("pyproject.toml", content)
    assert result["python_min"] == "3.10"
    assert result["python_max"] == "3.13"
    assert len(result["dependencies"]) == 2
    assert result["dependencies"][0]["name"] == "torch"
    assert result["dependencies"][0]["spec"] == "torch>=2.0.0"
    assert result["dependencies"][1]["is_pinned"] is True


def test_parse_pyproject_handles_no_requires_python():
    content = '[project]\nname = "x"\ndependencies = ["a>=1"]'
    result = parse_pyproject_toml("pyproject.toml", content)
    assert result["python_min"] is None
    assert result["python_max"] is None


def test_parse_pyproject_invalid_toml_returns_warnings():
    content = "this is { not valid toml"
    result = parse_pyproject_toml("pyproject.toml", content)
    assert "pyproject.toml" not in result.get("raw_files", {})
    assert len(result["scan_warnings"]) >= 1


# --- requirements.txt ---

def test_parse_requirements_txt_basic():
    content = """
# comment
torch>=2.0.0
numpy==1.26.0

-r other.txt
"""
    result = parse_requirements_txt("requirements.txt", content)
    assert len(result["dependencies"]) == 2
    assert result["dependencies"][0]["name"] == "torch"
    assert result["dependencies"][1]["is_pinned"] is True


def test_parse_requirements_txt_skips_recursive_and_comments():
    content = "# comment\n-c constraints.txt\nrequests"
    result = parse_requirements_txt("requirements.txt", content)
    assert len(result["dependencies"]) == 1
    assert result["dependencies"][0]["name"] == "requests"


# --- install.py ---

def test_parse_install_py_finds_pip_install_strings():
    content = """
import subprocess
subprocess.check_call(["pip", "install", "torch>=2.0.0", "transformers==4.30"])
"""
    result = parse_install_py("install.py", content)
    names = {d["name"] for d in result["dependencies"]}
    assert "torch" in names
    assert "transformers" in names


def test_parse_install_py_finds_os_system():
    content = """
import os
os.system("pip install opencv-python>=4.5")
"""
    result = parse_install_py("install.py", content)
    assert any(d["name"] == "opencv-python" for d in result["dependencies"])


# --- node_class_mappings ---

def test_parse_node_class_mappings_from_init():
    content = """
from comfy.nodes import something

NODE_CLASS_MAPPINGS = {
    "MyNode1": MyNodeClass1,
    "MyNode2": MyNodeClass2,
}
"""
    result = parse_node_class_mappings("__init__.py", content)
    assert "MyNode1" in result["node_class_mappings"]
    assert "MyNode2" in result["node_class_mappings"]


def test_parse_node_class_mappings_from_nodes_py():
    content = "NODE_CLASS_MAPPINGS = {\n  'Foo': Foo,\n  'Bar': Bar,\n}"
    result = parse_node_class_mappings("nodes.py", content)
    assert set(result["node_class_mappings"]) == {"Foo", "Bar"}


def test_parse_node_class_mappings_missing_returns_empty():
    result = parse_node_class_mappings("__init__.py", "x = 1\n")
    assert result["node_class_mappings"] == []


# --- README.md ---

def test_parse_readme_incompatibilities_basic():
    content = """
# My Node

This node is incompatible with: comfyui-impact-pack, comfyui-old-node.

Do not install with bad-node-1.
"""
    result = parse_readme_incompatibilities("README.md", content)
    assert "comfyui-impact-pack" in result["incompatibilities"]
    assert "comfyui-old-node" in result["incompatibilities"]


def test_parse_readme_no_incompatibilities_returns_empty():
    content = "# README\nThis is a normal readme.\n"
    result = parse_readme_incompatibilities("README.md", content)
    assert result["incompatibilities"] == []


# --- pipeline ---

def test_parse_version_files_merges_all():
    files = {
        "pyproject.toml": '[project]\nrequires-python = ">=3.10"\ndependencies = ["a>=1"]\n',
        "requirements.txt": "b==2.0\n",
        "__init__.py": 'NODE_CLASS_MAPPINGS = {"Foo": X}\n',
        "README.md": "Incompatible with: bad-node\n",
    }
    result = parse_version_files(files)
    assert result["python_min"] == "3.10"
    assert len(result["dependencies"]) == 2
    assert "Foo" in result["node_class_mappings"]
    assert "bad-node" in result["incompatibilities"]


def test_parse_version_files_empty_input():
    result = parse_version_files({})
    assert result["python_min"] is None
    assert result["python_max"] is None
    assert result["dependencies"] == []
    assert result["node_class_mappings"] == []
    assert result["incompatibilities"] == []
