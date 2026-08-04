# Targeted Reversions
When the user asks to "revert" or "go back to the old design", DO NOT perform a blunt `git reset --hard` or `git checkout` without inspecting the commit history. You MUST identify and preserve any functional bug fixes, state logic, or critical features that were implemented *after* the target reversion point. Isolate UI/CSS changes from functional logic.

# Responsive Viewport Locks (Impeccable UI)
When designing "desktop-app-like" interfaces with fixed viewports (`h-screen overflow-hidden`), NEVER apply these locks globally across all screen sizes. You MUST use responsive breakpoints to release the lock on mobile (`min-h-screen flex flex-col lg:h-screen lg:overflow-hidden`). Ensure stacked elements have appropriate `min-h-[X]` values on mobile so users can natively scroll the page.
