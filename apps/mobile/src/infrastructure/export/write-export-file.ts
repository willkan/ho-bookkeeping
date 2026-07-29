import { File, Paths } from 'expo-file-system';

/**
 * Write export bytes using the current expo-file-system File/Paths API.
 * Never uses deprecated main-entry string write helpers.
 */
export function writeExportFile(
  filename: string,
  bytes: Uint8Array,
): { uri: string; pathLabel: string } {
  const file = new File(Paths.cache, filename);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);
  return { uri: file.uri, pathLabel: file.uri };
}
