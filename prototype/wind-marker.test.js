import test from 'node:test';
import assert from 'node:assert/strict';
import { clampWindPosition } from './wind-marker.js';

test('wind marker stays fully inside the square terrain canvas', () => {
  assert.deepEqual(clampWindPosition({ x: 950, y: -20 }, true), { x: 870, y: 30 });
  assert.deepEqual(clampWindPosition({ x: 150, y: 750 }, true), { x: 230, y: 670 });
});

test('wind marker stays fully inside the schematic canvas', () => {
  assert.deepEqual(clampWindPosition({ x: -10, y: 800 }, false), { x: 30, y: 670 });
  assert.deepEqual(clampWindPosition({ x: 1200, y: 10 }, false), { x: 1070, y: 30 });
});

test('wind marker retains a position within the visible canvas', () => {
  assert.deepEqual(clampWindPosition({ x: 700, y: 470 }, true), { x: 700, y: 470 });
});
