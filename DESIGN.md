# THRESHOLD — a liminal horror in five levels

## 1. Research summary

**Reference — *Liminality* (Lory Games, Steam 2916260).** A first-person, exploration-led
"relaxing liminal horror". Its visual identity (from the 24 store screenshots):
clean white square ceramic tile on every surface, lukewarm turquoise water flooding the floors,
repeating semicircular arches, cylindrical pillars, square skylights / fake painted skies,
yellow-green tinted corridors, water slides & circular tunnels, and a final grassy hill under a
blue sky. The horror comes from emptiness and the feeling that you are *almost* alone.

**Tech (November 2026)**
| Area | Choice | Why |
|---|---|---|
| Renderer | three.js **r187** `WebGPURenderer` (auto WebGL2 fallback) | current release (30 Oct 2026) |
| Shading | **TSL** node materials (compiled to WGSL / GLSL) | the new shader system; no ShaderMaterial |
| Many lights | **ClusteredLighting** (Forward+ clustered, r185+) | hundreds of fluorescent fixtures per level |
| AO | **GTAO** fed into the ambient term via `builtinAOContext` | ground-truth AO, current approach |
| AA / denoise | **TRAA** temporal reprojection with a velocity prepass | resolves GTAO noise & edges |
| Water | `reflector()` planar reflection + `viewportSharedTexture()` refraction | from Water2Mesh, plus TSL caustics |
| Post | RenderPipeline: bloom → AgX tone map → custom TSL horror grade | VHS jitter, chromatic aberration, grain |
| Textures | **ambientCG CC0 PBR** (colour / normal / roughness / AO), 2K → WebP | photoreal, clean, licence-free |
| Sky / IBL | **Poly Haven** CC0 HDRI (kloofendal partly cloudy) | real image-based lighting & outdoor sky |
| Art | AI-generated: key art, four Polaroid "memories", hotel painting + edited anomaly variant | |
| Audio | 100 % procedural **Web Audio**: HRTF panners, convolution reverb from synthetic IRs | no audio files needed |

## 2. Game plan

You fall asleep at home and wake up *somewhere else*. Each level is one threshold further from
home and has its own mechanic.

| # | Level | Space | Mechanic | Threat |
|---|---|---|---|---|
| 1 | **The Lobby** | Backrooms: mono-yellow wallpaper, damp carpet, ~200 fluorescent lights | Find 3 fuses → power the elevator | Blackouts: when the lights die, *the Hollow* hunts you (flashlight) |
| 2 | **The Poolrooms** | White tile, flooded halls, pillars, skylights, deep basins | Turn 3 valves → water level drains, revealing the tunnel | None… mostly. Something watches from far away |
| 3 | **The Aqueduct** | Endless tiled arcades, fake sky, sun shafts | Collect 4 Polaroid memories → doorway opens | Mannequins move only when unseen |
| 4 | **Floor 8** | Looping hotel corridor | Anomaly loop: spot it, turn back; none, keep going. 5 in a row | Wrong guesses reset; one anomaly runs at you |
| 5 | **The Deep End** | Flooded concrete drains, darkness, emergency lights | Pull 2 levers → floodgate opens → reach the light | The Hollow hunts by sight and sound |
| ∞ | **The Hill** | Outdoor HDR sky, 100k wind-swept grass blades, a lone door | Walk to the door | — |

## 3. Systems design
* **Grid-based world builder** emits only visible faces, with world-space UVs in metres so every
  tile lines up at true physical scale (12.5 cm pool tiles, 60 cm ceiling tiles).
  Arches use extruded shapes with an arc-length UV generator so tiles wrap around the soffit.
* **Collision**: AABB grid cells + circle colliders, axis-separated resolution; ground-height
  function per level (ramps, basins); wading slows you down.
* **Player**: pointer-lock mouse look, sprint stamina, crouch, head-bob, flashlight (battery),
  surface-aware footsteps.
* **AI**: BFS path-finding on the level grid, DDA line-of-sight, hearing (sprinting is loud).
* **Quality tiers**: Ultra (GTAO + TRAA + reflections at full res) / High / Low.
* **Saving**: unlocked levels, settings, deaths and time are kept in localStorage.
