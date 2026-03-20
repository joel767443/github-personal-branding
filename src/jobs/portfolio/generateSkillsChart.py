import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def generate_skills_chart(tech_stack: dict, arch_counts: dict, output_path: Path) -> None:
    """
    Render a 2-row bar chart matching the provided sample design:
    - white background
    - default Matplotlib blue bars for skill distribution
    - `tab:orange` bars for architecture counts
    - figsize=(10, 8) -> 1000x800 at the default DPI
    - rotated x tick labels
    """

    skill_names = list(tech_stack.keys()) if tech_stack else []
    skill_values = list(tech_stack.values()) if tech_stack else []

    arch_counts = arch_counts or {}
    arch_names = list(arch_counts.keys())
    arch_values = list(arch_counts.values())
    has_arch = bool(arch_counts)

    # Match the sample image size (1000x800).
    if has_arch:
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8))
    else:
        fig, ax1 = plt.subplots(1, 1, figsize=(10, 4))

    # Top chart: skills
    if skill_names:
        ax1.bar(skill_names, skill_values)
        ax1.set_title("Developer Skill Distribution")
        ax1.set_xticks(range(len(skill_names)))
        ax1.set_xticklabels(skill_names, rotation=45, ha="right")

    # Bottom chart: architectures
    if has_arch:
        ax2.bar(arch_names, arch_values, color="tab:orange")
        ax2.set_title("Detected Architectures Across Repositories")
        ax2.set_xticks(range(len(arch_names)))
        ax2.set_xticklabels(arch_names, rotation=45, ha="right")

    fig.tight_layout()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path)
    plt.close(fig)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: generateSkillsChart.py <output_png_path>")

    output_path = Path(sys.argv[1])
    payload = json.loads(sys.stdin.read() or "{}")

    tech_stack = payload.get("techStack") or {}
    arch_counts = payload.get("archCounts") or {}

    generate_skills_chart(tech_stack, arch_counts, output_path)


if __name__ == "__main__":
    main()

