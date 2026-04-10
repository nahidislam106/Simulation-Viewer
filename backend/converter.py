import os
from typing import Callable, Optional

import numpy as np
import pyvista as pv


def convert_to_vtp(
    file_id: str,
    source_path: str,
    output_dir: str,
    progress_callback: Optional[Callable[[int, str], None]] = None,
) -> dict:
    def emit(percent: int, message: str) -> None:
        if progress_callback:
            progress_callback(percent, message)

    ext = os.path.splitext(source_path)[1].lower()

    if ext == ".mph":
        return {
            "status": "pending_conversion",
            "message": (
                "MPH is a proprietary COMSOL format and cannot be converted automatically.\n\n"
                "To view this file:\n"
                "1. Open it in COMSOL Multiphysics\n"
                "2. Export → Export Mesh → choose VTK (.vtk) or VTU (.vtu) format\n"
                "3. Open the exported file in Simulation Viewer"
            ),
        }

    try:
        emit(10, "Reading file...")
        mesh = pv.read(source_path)

        emit(40, "Extracting surface...")
        surface = mesh.extract_surface(algorithm="dataset_surface")

        emit(70, "Triangulating...")
        triangulated = surface.triangulate()

        emit(85, "Saving VTP...")
        os.makedirs(output_dir, exist_ok=True)
        vtp_path = os.path.join(output_dir, f"{file_id}.vtp")
        triangulated.save(vtp_path)

        scalars: list[dict] = []

        for name in triangulated.point_data.keys():
            arr = triangulated.point_data[name]
            if arr.ndim == 1:
                finite_vals = arr[np.isfinite(arr)]
                if len(finite_vals) > 0:
                    scalars.append({
                        "name": name,
                        "association": "point",
                        "min": float(finite_vals.min()),
                        "max": float(finite_vals.max()),
                    })

        for name in triangulated.cell_data.keys():
            arr = triangulated.cell_data[name]
            if arr.ndim == 1:
                finite_vals = arr[np.isfinite(arr)]
                if len(finite_vals) > 0:
                    scalars.append({
                        "name": name,
                        "association": "cell",
                        "min": float(finite_vals.min()),
                        "max": float(finite_vals.max()),
                    })

        bounds: list[float] = list(triangulated.bounds)

        emit(100, "Done")

        return {
            "status": "ready",
            "vtp_path": vtp_path,
            "scalars": scalars,
            "stats": {
                "points": int(triangulated.n_points),
                "cells": int(triangulated.n_cells),
                "bounds": bounds,
            },
        }

    except Exception as exc:
        return {"status": "error", "message": str(exc)}
