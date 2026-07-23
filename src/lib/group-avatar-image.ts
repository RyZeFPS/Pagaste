import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';

export const GROUP_AVATAR_SIZE = 512;
export const GROUP_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

async function imageByteLength(uri: string): Promise<number> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('No se ha podido leer la foto seleccionada.');
    return (await response.arrayBuffer()).byteLength;
  }

  return new File(uri).size;
}

export async function pickProcessedGroupAvatar(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset?.uri) throw new Error('No se ha podido abrir la foto seleccionada.');

  const actions: Action[] = [];
  const sourceWidth = Number(asset.width);
  const sourceHeight = Number(asset.height);
  if (sourceWidth > 0 && sourceHeight > 0) {
    const squareSize = Math.min(sourceWidth, sourceHeight);
    actions.push({
      crop: {
        originX: Math.max(0, Math.floor((sourceWidth - squareSize) / 2)),
        originY: Math.max(0, Math.floor((sourceHeight - squareSize) / 2)),
        width: squareSize,
        height: squareSize,
      },
    });
  }
  actions.push({ resize: { width: GROUP_AVATAR_SIZE, height: GROUP_AVATAR_SIZE } });

  const processed = await manipulateAsync(asset.uri, actions, {
    compress: 0.8,
    format: SaveFormat.JPEG,
  });

  if ((await imageByteLength(processed.uri)) > GROUP_AVATAR_MAX_BYTES) {
    throw new Error('La foto sigue ocupando más de 2 MB. Elige otra imagen.');
  }

  return processed.uri;
}
