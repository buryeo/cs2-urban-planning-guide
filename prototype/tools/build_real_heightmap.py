"""Build a local 4096 px heightmap of San Francisco Bay from Mapzen Terrain Tiles.

Run with Python, NumPy and Pillow installed. The generated files stay in
prototype/local-samples/ and are intentionally excluded from Git.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
import json
import math
from pathlib import Path
import time
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image


ZOOM = 12
START_X = 649
START_Y = 1576
TILES = 16
TILE_SIZE = 256
OUTPUT_DIR = Path(__file__).resolve().parents[1] / 'local-samples'
TILE_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'


def tile_for_point(latitude, longitude, zoom):
    size = 1 << zoom
    x = math.floor((longitude + 180) / 360 * size)
    y = math.floor((1 - math.asinh(math.tan(math.radians(latitude))) / math.pi) / 2 * size)
    return x, y


def tile_bounds(zoom, start_x, start_y, tiles):
    size = 1 << zoom
    def longitude(x):
        return x / size * 360 - 180
    def latitude(y):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / size))))
    return longitude(start_x), latitude(start_y + tiles), longitude(start_x + tiles), latitude(start_y)


def decode_terrarium(rgb):
    """Mapzen RGB elevation encoding to meters, including negative bathymetry."""
    channels = rgb.astype(np.float32)
    return channels[..., 0] * 256 + channels[..., 1] + channels[..., 2] / 256 - 32768


def encode_height(meters):
    """Linearly encode -300 m as 0 and 0 m as 12000; 1 grayscale unit = 2.5 cm."""
    return np.clip(np.rint((meters.astype(np.float32) + 300) * 40), 0, 65535).astype(np.uint16)


def repair_extreme_pits(meters):
    """Replace isolated source voids below -1500 m with nearby valid terrain."""
    valid = meters >= -1500
    repaired = meters.copy()
    bad_y, bad_x = np.where(~valid)
    for y, x in zip(bad_y, bad_x):
        for radius in range(1, 33):
            y0, y1 = max(0, y - radius), min(meters.shape[0], y + radius + 1)
            x0, x1 = max(0, x - radius), min(meters.shape[1], x + radius + 1)
            nearby = meters[y0:y1, x0:x1][valid[y0:y1, x0:x1]]
            if nearby.size:
                repaired[y, x] = np.median(nearby)
                break
        else:
            raise ValueError(f'No valid elevation near pixel {x},{y}')
    return repaired, len(bad_x)


def fetch_tile(x, y, cache_dir):
    path = cache_dir / f'{x}-{y}.png'
    source = ''
    if not path.exists():
        url = TILE_URL.format(z=ZOOM, x=x, y=y)
        for attempt in range(3):
            try:
                with urlopen(Request(url, headers={'User-Agent': 'CS2-Urban-Planning-Guide/0.1'}), timeout=30) as response:
                    data = response.read()
                    source = response.headers.get('x-amz-meta-x-imagery-sources', '')
                with Image.open(BytesIO(data)) as image:
                    if image.size != (TILE_SIZE, TILE_SIZE):
                        raise ValueError(f'Unexpected tile size: {image.size}')
                path.write_bytes(data)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    with Image.open(path) as image:
        rgb = np.asarray(image.convert('RGB'), dtype=np.uint8)
    return x, y, decode_terrarium(rgb), source


def terrain_preview(meters):
    """Render an explanatory color relief; this is not the import heightmap."""
    surface = meters[::2, ::2]
    levels = [-300, -30, -1, 0, 0.01, 15, 70, 180, 400, 750, 1300]
    colors = [
        (69, 119, 162), (126, 176, 212), (165, 205, 225),
        (165, 205, 225), (218, 230, 208), (205, 226, 184), (165, 202, 142),
        (132, 174, 126), (191, 187, 151), (215, 205, 179), (247, 246, 239),
    ]
    color = np.stack([
        np.interp(surface, levels, [item[channel] for item in colors])
        for channel in range(3)
    ], axis=-1)
    color[surface <= 0] = (151, 194, 221)
    north_south, east_west = np.gradient(surface)
    shade = np.clip(0.98 + (-(east_west + north_south)) * 0.012, 0.72, 1.15)
    shade = np.where(surface <= 0, 1, shade)
    bands = np.floor(np.maximum(surface, 0) / 25)
    contour = (surface > 20) & ((bands != np.roll(bands, 1, axis=0)) | (bands != np.roll(bands, 1, axis=1)))
    shade = np.where(contour, shade * 0.90, shade)
    return Image.fromarray(np.clip(color * shade[..., None], 0, 255).astype(np.uint8), 'RGB')


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    cache_dir = OUTPUT_DIR / 'san-francisco-bay-tiles'
    cache_dir.mkdir(exist_ok=True)
    size = TILES * TILE_SIZE
    meters = np.empty((size, size), dtype=np.float32)
    sources = set()
    tile_pairs = [(START_X + dx, START_Y + dy) for dy in range(TILES) for dx in range(TILES)]
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(fetch_tile, x, y, cache_dir) for x, y in tile_pairs]
        for count, future in enumerate(as_completed(futures), 1):
            x, y, terrain, source = future.result()
            x0 = (x - START_X) * TILE_SIZE
            y0 = (y - START_Y) * TILE_SIZE
            meters[y0:y0 + TILE_SIZE, x0:x0 + TILE_SIZE] = terrain
            if source:
                sources.update(part.strip() for part in source.split(',') if part.strip())
            if count % 32 == 0:
                print(f'Downloaded {count}/{len(tile_pairs)} tiles', flush=True)

    raw_minimum = float(meters.min())
    meters, repaired_pit_pixels = repair_extreme_pits(meters)
    heightmap_path = OUTPUT_DIR / 'san-francisco-bay-heightmap.png'
    preview_path = OUTPUT_DIR / 'san-francisco-bay-terrain-preview.png'
    metadata_path = OUTPUT_DIR / 'san-francisco-bay-source.json'
    Image.fromarray(encode_height(meters)).save(heightmap_path, optimize=True)
    terrain_preview(meters).save(preview_path, optimize=True)
    west, south, east, north = tile_bounds(ZOOM, START_X, START_Y, TILES)
    metadata = {
        'place': 'San Francisco Bay, California, United States',
        'bounds_lonlat': {'west': west, 'south': south, 'east': east, 'north': north},
        'raster': {'width': size, 'height': size, 'projection': 'Web Mercator (EPSG:3857)'},
        'tile_grid': {'zoom': ZOOM, 'start_x': START_X, 'start_y': START_Y, 'tiles_each_side': TILES},
        'height_encoding': 'grayscale16 = clip(round((elevation_m + 300) * 40), 0, 65535)',
        'elevation_meters': {'min': float(meters.min()), 'max': float(meters.max()), 'sea_level_pixels': int(np.count_nonzero(np.abs(meters) < 0.5))},
        'source_void_repair': {'raw_minimum_meters': raw_minimum, 'pixels_below_minus_1500_m_replaced_from_nearby_valid_elevation': repaired_pit_pixels},
        'source': 'Mapzen Terrain Tiles / Terrarium, on the AWS Open Data Registry',
        'source_url': 'https://registry.opendata.aws/terrain-tiles/',
        'source_imagery_ids_reported_by_tiles': sorted(sources),
        'attribution': 'Mapzen. USGS 3DEP/NED and SRTM terrain data courtesy of the U.S. Geological Survey. NOAA ETOPO1 terrain data: U.S. National Oceanic and Atmospheric Administration.',
        'note': 'Terrain elevation only; no actual roads, zoning, wind, navigation channels or game map metadata.',
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{heightmap_path}\n{preview_path}\n{metadata_path}')
    print(f'Bounds W/S/E/N: {west:.5f}, {south:.5f}, {east:.5f}, {north:.5f}')
    print(f'Elevation range: {meters.min():.1f} to {meters.max():.1f} m')


if __name__ == '__main__':
    main()
