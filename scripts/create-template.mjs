import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const width = 1684;
const height = 1190;
const rectangle = (left, top, rectWidth, rectHeight, color) => ({
  input: { create: { width: rectWidth, height: rectHeight, channels: 4, background: color } }, left, top
});
await mkdir(new URL('../public/assets/', import.meta.url), { recursive: true });
await sharp({ create: { width, height, channels: 4, background: '#fcfcf8' } }).composite([
  rectangle(38, 38, 1608, 1114, '#17624e'), rectangle(42, 42, 1600, 1106, '#fcfcf8'),
  rectangle(57, 57, 1570, 1076, '#d6dfd3'), rectangle(59, 59, 1566, 1072, '#fcfcf8'),
  rectangle(755, 145, 174, 5, '#17624e'), rectangle(692, 232, 300, 2, '#d6dfd3'),
  rectangle(552, 610, 580, 2, '#d6dfd3'), rectangle(789, 874, 106, 5, '#c6a755'),
  rectangle(38, 38, 155, 12, '#17624e'), rectangle(38, 38, 12, 155, '#17624e'),
  rectangle(1491, 1140, 155, 12, '#17624e'), rectangle(1634, 997, 12, 155, '#17624e')
]).png().toFile(new URL('../public/assets/certificate-background.png', import.meta.url).pathname);
console.log('Sample A4 landscape certificate background generated.');