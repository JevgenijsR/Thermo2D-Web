# Thermo2D Web

Browser-based 2D stationary and transient thermal analysis. Open the app: https://JevgenijsR.github.io/Thermo2D-Web/

DXF LINE/LWPOLYLINE import, material presets, editable boundary temperatures, conforming triangular FEM, mesh convergence, single-canvas region selection, fixed-temperature regions, raster overlay, PNG/JPEG/PDF/JSON export. Units: mm; conductivity W/(m K); heat flow W/m.

User models are processed locally in the browser; no upload API or analytics. Edits are saved in browser storage with a versioned backup. Download model JSON to transfer to another computer. The built-in examples are synthetic verification geometry.

Surface humidity and dew-point checks; experimental 2D vapour diffusion with converged condensation zones. Transient conduction includes energy accumulation and boundary/source flows. No seasonal moisture storage or freezing. These features do not establish full ISO compliance.

Material values are editable starting assumptions, not a certified design database. Air conductivity does not model convection/radiation. Curved DXF entities and INSERT blocks are rejected. Separate fasteners require 3D, not this translationally invariant 2D model.

Temporary public runtime distribution. Private project history, drawings and reference images are not included.
