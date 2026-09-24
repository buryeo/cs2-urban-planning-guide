import unittest

import numpy as np

from build_real_heightmap import encode_height, tile_bounds, tile_for_point, decode_terrarium, repair_extreme_pits, terrain_preview


class RealHeightmapTests(unittest.TestCase):
    def test_terrarium_decodes_meters(self):
        rgb = np.array([[[128, 0, 0], [128, 100, 128]]], dtype=np.uint8)
        np.testing.assert_allclose(decode_terrarium(rgb), [[0, 100.5]])

    def test_height_encoding_is_linear_and_preserves_sea_level(self):
        values = encode_height(np.array([-300, -20, 0, 100, 1000, 2000], dtype=np.float32))
        self.assertEqual(values.dtype, np.dtype('uint16'))
        self.assertEqual(values.tolist(), [0, 11200, 12000, 16000, 52000, 65535])

    def test_san_francisco_bay_tile_extent_contains_city(self):
        x, y = tile_for_point(37.65, -122.25, 12)
        self.assertEqual((x, y), (657, 1584))
        west, south, east, north = tile_bounds(12, 649, 1576, 16)
        self.assertLess(west, -122.4)
        self.assertGreater(east, -122.4)
        self.assertLess(south, 37.77)
        self.assertGreater(north, 37.77)

    def test_repair_only_extreme_source_pits(self):
        source = np.array([[10, 11, 12], [9, -22005, 13], [8, 7, 6]], dtype=np.float32)
        repaired, count = repair_extreme_pits(source)
        self.assertEqual(count, 1)
        self.assertEqual(repaired[1, 1], 9.5)
        self.assertEqual(repaired[0, 0], 10)

    def test_zero_meter_sea_surface_is_blue_in_preview(self):
        image = terrain_preview(np.zeros((4, 4), dtype=np.float32))
        red, green, blue = image.getpixel((0, 0))
        self.assertGreater(blue, red)
        self.assertGreater(blue, green)

    def test_preview_does_not_expose_bathymetry_tile_seams(self):
        sample = np.array([[-100, -100, 0, 0], [-100, -100, 0, 0],
                           [-100, -100, 0, 0], [-100, -100, 0, 0]], dtype=np.float32)
        image = terrain_preview(sample)
        self.assertEqual(image.getpixel((0, 0)), image.getpixel((1, 0)))


if __name__ == '__main__':
    unittest.main()
