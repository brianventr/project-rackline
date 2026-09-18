const PATTERNS = [
  "11011001100",
  "11001101100",
  "11001100110",
  "10010011000",
  "10010001100",
  "10001001100",
  "10011001000",
  "10011000100",
  "10001100100",
  "11001001000",
  "11001000100",
  "11000100100",
  "10110011100",
  "10011011100",
  "10011001110",
  "10111001100",
  "10011101100",
  "10011100110",
  "11001110010",
  "11001011100",
  "11001001110",
  "11011100100",
  "11001110100",
  "11101101110",
  "11101001100",
  "11100101100",
  "11100100110",
  "11101100100",
  "11100110100",
  "11100110010",
  "11011011000",
  "11011000110",
  "11000110110",
  "10100011000",
  "10001011000",
  "10001000110",
  "10110001000",
  "10001101000",
  "10001100010",
  "11010001000",
  "11000101000",
  "11000100010",
  "10110111000",
  "10110001110",
  "10001101110",
  "10111011000",
  "10111000110",
  "10001110110",
  "11101110110",
  "11010001110",
  "11000101110",
  "11011101000",
  "11011100010",
  "11011101110",
  "11101011000",
  "11101000110",
  "11100010110",
  "11101101000",
  "11101100010",
  "11100011010",
  "11101111010",
  "11001000010",
  "11110001010",
  "10100110000",
  "10100001100",
  "10010110000",
  "10010000110",
  "10000101100",
  "10000100110",
  "10110010000",
  "10110000100",
  "10011010000",
  "10011000010",
  "10000110100",
  "10000110010",
  "11000010010",
  "11001010000",
  "11110111010",
  "11000010100",
  "10001111010",
  "10100111100",
  "10010111100",
  "10010011110",
  "10111100100",
  "10011110100",
  "10011110010",
  "11110100100",
  "11110010100",
  "11110010010",
  "11011011110",
  "11011110110",
  "11110110110",
  "10101111000",
  "10100011110",
  "10001011110",
  "10111101000",
  "10111100010",
  "11110101000",
  "11110100010",
  "10111011110",
  "10111101110",
  "11101011110",
  "11110101110",
  "11010000100",
  "11010010000",
  "11010011100",
  "11000111010",
];

const START_B = 104;
const STOP = 106;

export function encodeCode128Bits(text: string): string {
  const values = [START_B];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`Code 128 cannot encode ${JSON.stringify(char)}`);
    }
    values.push(code - 32);
  }
  let checksum = START_B;
  for (let i = 1; i < values.length; i += 1) {
    checksum += values[i]! * i;
  }
  values.push(checksum % 103);
  values.push(STOP);
  return values.map((value) => PATTERNS[value]!).join("") + "11";
}

export function barcodeSvg(text: string, options?: { height?: number; module?: number }): string {
  const bits = encodeCode128Bits(text);
  const module = options?.module ?? 2;
  const barHeight = options?.height ?? 48;
  const quiet = 10 * module;
  const width = bits.length * module + quiet * 2;
  const parts: string[] = [];
  let x = quiet;
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "1") {
      let run = 0;
      while (bits[i] === "1") {
        run += 1;
        i += 1;
      }
      parts.push(`<rect x="${x}" y="0" width="${run * module}" height="${barHeight}" />`);
      x += run * module;
    } else {
      x += module;
      i += 1;
    }
  }
  const labelY = barHeight + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${labelY + 6}" viewBox="0 0 ${width} ${labelY + 6}" role="img" aria-label="${text}">
  <rect width="100%" height="100%" fill="#fffaf3" />
  <g fill="#1b1712">${parts.join("")}</g>
  <text x="${width / 2}" y="${labelY}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="12" fill="#1b1712">${text}</text>
</svg>`;
}
