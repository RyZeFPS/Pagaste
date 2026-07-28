import Svg, { Rect } from 'react-native-svg';
import { encodeQrCode } from '@/domain/qr-code';

export function QrCode({
  value,
  size = 224,
  accessibilityLabel,
}: {
  value: string;
  size?: number;
  accessibilityLabel: string;
}) {
  const matrix = encodeQrCode(value);
  const quietZone = 4;
  const viewBoxSize = matrix.length + quietZone * 2;
  return (
    <Svg
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
    >
      <Rect width={viewBoxSize} height={viewBoxSize} fill="#FFFFFF" rx={2} />
      {matrix.flatMap((row, y) =>
        row.flatMap((dark, x) =>
          dark ? (
            <Rect
              key={`${x}-${y}`}
              x={x + quietZone}
              y={y + quietZone}
              width={1}
              height={1}
              fill="#111827"
            />
          ) : (
            []
          ),
        ),
      )}
    </Svg>
  );
}
