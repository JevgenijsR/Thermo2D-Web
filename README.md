# Thermo2D Web

Browser-based 2D stationary thermal analysis. Open the app: https://JevgenijsR.github.io/Thermo2D-Web/

DXF LINE/LWPOLYLINE import, material presets, editable boundary temperatures, conforming triangular FEM, mesh convergence, single-canvas region selection, fixed-temperature regions, raster overlay, PNG/JPEG/PDF/JSON export. Units: mm; conductivity W/(m K); heat flow W/m.

User models are processed locally in the browser; no upload API or analytics. Explicit saves use browser storage. Download model JSON to transfer to another computer. The built-in examples are synthetic verification geometry.

Material values are editable starting assumptions, not a certified design database. Air conductivity does not model convection/radiation. Curved DXF entities and INSERT blocks are rejected. Separate fasteners require 3D, not this translationally invariant 2D model.

Temporary public runtime distribution. Private project history, drawings and reference images are not included.
