"""Deterministic, self-contained SVG bend explanations (no scripts or external assets).
These are independent cross-section schematics, not a tooling/assembly motion solve.
"""
import math
from pathlib import Path
from xml.sax.saxutils import escape


def diagram(bends, thickness, k_factor, output):
    if not bends or len(bends) > 24:
        raise ValueError('Fold explanation supports 1–24 bends')
    k = k_factor['value'] / (2 if k_factor['standard'] == 'din' else 1)
    width, row_height = 900, 240
    height = 110 + row_height*len(bends)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img">',
           '<title>Sheet metal bend explanations</title>',
           '<desc>Each bend shown independently from flat to folded. Loop restarts are visual resets, not a manufacturing sequence.</desc>',
           '<style>.still{display:none}@media(prefers-reduced-motion:reduce){.animated{display:none}.still{display:inline}}</style>',
           f'<rect width="{width}" height="{height}" fill="#101c2a"/>',
           '<g font-family="sans-serif" fill="#eff5fb">',
           '<text x="32" y="38" font-size="24">From flat stock to a bend</text>',
           '<text x="32" y="65" font-size="14">Independent cross-section schematics • illustrative flange lengths • no tooling or collision simulation</text>',
           '<text x="32" y="86" font-size="13" fill="#a9bacb">Six-second loop: fold, hold, then visual reset. Bend order is not a manufacturing recommendation.</text>']
    for i, bend in enumerate(bends):
        angle = bend['angleDeg']; radius = bend['innerRadiusMm']
        if not math.isfinite(angle) or not 0 < abs(angle) <= 180.001 or not math.isfinite(radius) or radius <= 0:
            raise ValueError('Fold diagram supports positive-radius bends up to 180 degrees')
        theta = math.radians(angle)
        neutral_length = abs(theta)*(radius+k*thickness)
        # Illustrative legs, scaled with the true radius/thickness so every bend fits.
        leg = max(20, 2*radius, 5*thickness)
        extent = 2*leg + neutral_length + 2*thickness
        scale = min(540/extent, 150/extent)
        ox, oy = 620, 110+i*row_height+120
        def profile(fraction):
            a = theta*fraction
            def point(u):
                if abs(a) < 1e-10: return neutral_length*u, 0, 0
                phi = a*u; r = neutral_length/a
                return r*math.sin(phi), r*2*math.sin(phi/2)**2, phi
            spine = [(-leg, 0, 0), (0, 0, 0)] + [point(j/24) for j in range(1,25)]
            x,y,p = spine[-1]; spine.append((x+leg*math.cos(p), y+leg*math.sin(p), p))
            upper, lower = ((k*thickness, -(1-k)*thickness) if angle > 0 else ((1-k)*thickness, -k*thickness))
            def side(offset):
                return [(ox+scale*(x-offset*math.sin(p)), oy-scale*(y+offset*math.cos(p))) for x,y,p in spine]
            points = side(upper)+list(reversed(side(lower)))
            return 'M'+' L'.join(f'{x:.4f},{y:.4f}' for x,y in points)+' Z'
        final = profile(1)
        values = [profile(j/24) for j in range(25)]+[final, final, profile(0)]
        times = [j/24*.65 for j in range(25)]+[.8, .999, 1]
        y = 110+i*row_height
        label = escape(bend['face'])
        svg += [f'<path d="M32 {y+row_height-12}H868" stroke="#304154"/>',
                f'<text x="32" y="{y+35}" font-size="19">Bend {i+1} · {label}</text>',
                f'<text x="32" y="{y+65}" font-size="15">Rotation from flat: {angle:.3g}°</text>',
                f'<text x="32" y="{y+91}" font-size="15">Inside radius: {radius:.4g} mm · thickness: {thickness:.4g} mm</text>',
                f'<text x="32" y="{y+117}" font-size="15">K-factor: {k:.4g} ANSI · allowance: {neutral_length:.4g} mm</text>',
                f'<path d="{profile(0)}" fill="none" stroke="#71869c" stroke-dasharray="5 4"/>',
                f'<path class="still" d="{final}" fill="#53c6da" stroke="#bceff7"/>',
                f'<path class="animated" d="{final}" fill="#53c6da" stroke="#bceff7">',
                '<animate attributeName="d" dur="6s" repeatCount="indefinite" calcMode="linear" values="'+';'.join(values)+'" keyTimes="'+';'.join(f'{t:.8f}' for t in times)+'"/>',
                '</path>',
                f'<text x="490" y="{y+205}" font-size="13" fill="#a9bacb">Dashed = flat · cyan = bend illustration</text>']
    svg.append('</g></svg>')
    with Path(output).open('x') as f: f.write('\n'.join(svg)+'\n')
    return dict(file=str(output), kind='independent-bend-cross-sections', durationSeconds=6, repeat=True,
                embeddedJavaScript=False, deterministic=True, manufacturingSequence=False)
