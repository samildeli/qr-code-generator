export type QrCode = Module[][];

export class Module {
  value: boolean;
  isCodeword: boolean;

  constructor(value: boolean, isCodeword: boolean) {
    this.value = value;
    this.isCodeword = isCodeword;
  }
}

export enum EcLevel {
  L,
  M,
  Q,
  H,
}

export class QrCodeGenerator {
  qrCode: QrCode;
  version: number;
  ecLevel: EcLevel;
  data: string;

  constructor(version: number, ecLevel: EcLevel, data: string) {
    this.qrCode = [];
    this.version = version;
    this.ecLevel = ecLevel;
    this.data = data;
  }

  generate() {
    const codewords = this.createCodewords();
    this.initializeQrCode();
    this.placeFinderPatterns();
    this.placeAlignmentPatterns();
    this.placeTimingPatterns();
    if (this.version >= 7) {
      this.placeVersionInformation(QrCodeGenerator.VERSION_INFORMATION[this.version - 7]);
    }
    this.placeCodewords(codewords);
    const formatDataBits = ["01", "00", "11", "10"][this.ecLevel] + this.applyDataMask().toString(2).padStart(3, "0");
    this.placeFormatInformation(QrCodeGenerator.FORMAT_INFORMATION[parseInt(formatDataBits, 2)]);
  }

  createCodewords() {
    const dataCodewords = this.createDataCodewords();
    const [group1BlockSize, group1BlockCount, group2BlockSize, group2BlockCount] =
      QrCodeGenerator.DATA_CODEWORDS_PER_BLOCK[this.version - 1][this.ecLevel];
    const dataBlocks = [];

    for (let i = 0; i < group1BlockCount; i++) {
      dataBlocks.push(new Uint8Array(dataCodewords.splice(0, group1BlockSize)));
    }
    for (let i = 0; i < group2BlockCount; i++) {
      dataBlocks.push(new Uint8Array(dataCodewords.splice(0, group2BlockSize)));
    }

    const ecBlockSize = QrCodeGenerator.EC_CODEWORDS_PER_BLOCK[this.version - 1][this.ecLevel];
    const ecBlocks = dataBlocks.map((dataBlock) => this.reedSolomonEncode(dataBlock, ecBlockSize));

    return [...this.interleave(dataBlocks), ...this.interleave(ecBlocks)];
  }

  createDataCodewords() {
    const dataBytes = new TextEncoder().encode(this.data);
    const dataBits = [...dataBytes].map((byte) => byte.toString(2).padStart(8, "0")).join("");

    let bits = "";
    let dataCapacity = 0;

    if (this.version >= 1 && this.version <= 40) {
      bits = this.getDataHeaderBits(dataBytes.length) + dataBits;
      dataCapacity = QrCodeGenerator.DATA_CAPACITIES[this.version - 1][this.ecLevel];
    } else {
      // Automatic version selection
      for (this.version = 1; this.version <= 40; this.version++) {
        bits = this.getDataHeaderBits(dataBytes.length) + dataBits;
        dataCapacity = QrCodeGenerator.DATA_CAPACITIES[this.version - 1][this.ecLevel];

        if (bits.length <= dataCapacity) {
          break;
        }
      }
    }

    if (bits.length > dataCapacity) {
      const error = new Error(
        "Message exceeds data capacity. Increase version, decrease error correction level or shorten message.",
      );
      error.name = "QrCodeGeneratorError";
      throw error;
    }

    // Insert terminator bits.
    if (dataCapacity - bits.length >= 4) {
      bits += "0000";
    } else {
      bits += "0".repeat(dataCapacity - bits.length);
    }

    // Insert padding bits.
    const remainder = bits.length % 8;
    if (remainder !== 0) {
      bits += "0".repeat(8 - remainder);
    }

    // Insert padding codewords.
    for (let i = 0; bits.length < dataCapacity; i++) {
      bits += i % 2 === 0 ? "11101100" : "00010001";
    }

    return bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2));
  }

  getDataHeaderBits(dataLength: number) {
    return (
      "0111" + // ECI mode indicator
      "0" + // ECI designator header
      "0011010" + // ECI assignment number for UTF-8 (26)
      "0100" + // Byte mode indicator
      dataLength.toString(2).padStart(this.version <= 9 ? 8 : 16, "0") // Character count indicator
    );
  }

  reedSolomonEncode(data: Uint8Array, ecSize: number) {
    const genPoly = QrCodeGenerator.GENERATOR_POLYNOMIALS[ecSize];

    const paddedData = new Uint8Array(data.length + ecSize);
    paddedData.set(data);

    let ec = polyMod(paddedData, genPoly);

    // Insert leading zeros to reach ecSize if needed.
    const lenDiff = ecSize - ec.length;
    if (lenDiff > 0) {
      const paddedEc = new Uint8Array(ecSize);
      paddedEc.set(ec, lenDiff);
      ec = paddedEc;
    }

    return ec;
  }

  interleave(blocks: Uint8Array[]) {
    const interleaved = [];
    const maxSize = blocks[blocks.length - 1].length;

    for (let i = 0; i < maxSize; i++) {
      for (const block of blocks) {
        if (i < block.length) {
          interleaved.push(block[i]);
        }
      }
    }

    return interleaved;
  }

  initializeQrCode() {
    const size = 21 + (this.version - 1) * 4;
    this.qrCode = Array(size)
      .fill(undefined)
      .map(() => Array(size).fill(undefined));
  }

  placeFinderPatterns() {
    // Top left
    this.placePattern(QrCodeGenerator.FINDER_PATTERN, 0, 0);
    this.placePattern(QrCodeGenerator.VERTICAL_SEPARATOR, 7, 0);
    this.placePattern(QrCodeGenerator.HORIZONTAL_SEPARATOR, 0, 7);

    // Top right
    this.placePattern(QrCodeGenerator.FINDER_PATTERN, this.qrCode.length - 7, 0);
    this.placePattern(QrCodeGenerator.VERTICAL_SEPARATOR, this.qrCode.length - 8, 0);
    this.placePattern(QrCodeGenerator.HORIZONTAL_SEPARATOR, this.qrCode.length - 8, 7);

    // Bottom left
    this.placePattern(QrCodeGenerator.FINDER_PATTERN, 0, this.qrCode.length - 7);
    this.placePattern(QrCodeGenerator.VERTICAL_SEPARATOR, 7, this.qrCode.length - 8);
    this.placePattern(QrCodeGenerator.HORIZONTAL_SEPARATOR, 0, this.qrCode.length - 8);
  }

  placeAlignmentPatterns() {
    const positions = QrCodeGenerator.ALIGNMENT_PATTERN_POSITIONS[this.version - 1];

    for (const [j, y] of positions.entries()) {
      for (const [i, x] of positions.entries()) {
        if (
          (i === 0 && j === 0) ||
          (i === 0 && j === positions.length - 1) ||
          (i === positions.length - 1 && j === 0)
        ) {
          // Skip positions that overlap finder patterns.
          continue;
        }

        this.placePattern(QrCodeGenerator.ALIGNMENT_PATTERN, x - 2, y - 2);
      }
    }
  }

  placePattern(pattern: string[], x: number, y: number) {
    for (let y2 = 0; y2 < pattern.length; y2++) {
      for (let x2 = 0; x2 < pattern[0].length; x2++) {
        this.qrCode[y + y2][x + x2] = new Module(pattern[y2][x2] === "1", false);
      }
    }
  }

  placeTimingPatterns() {
    for (let x = 0; x < this.qrCode.length; x++) {
      if (this.qrCode[6][x] === undefined) {
        this.qrCode[6][x] = new Module(x % 2 === 0, false);
      }
    }

    for (let y = 0; y < this.qrCode.length; y++) {
      if (this.qrCode[y][6] === undefined) {
        this.qrCode[y][6] = new Module(y % 2 === 0, false);
      }
    }
  }

  placeCodewords(codewords: number[]) {
    const bits = codewords.map((byte) => byte.toString(2).padStart(8, "0")).join("");

    // Reserve format information modules.
    this.placeFormatInformation("0".repeat(15));

    let i = 0;
    let step = 0;
    let x = this.qrCode.length - 1;
    let y = this.qrCode.length - 1;
    let upwards = true;

    while (i < bits.length) {
      if (this.qrCode[y][x] === undefined) {
        this.qrCode[y][x] = new Module(bits[i++] === "1", true);
      }

      if (step % 2 === 1 && ((upwards && y === 0) || (!upwards && y === this.qrCode.length - 1))) {
        x = x === 7 ? x - 2 : x - 1;
        upwards = !upwards;
      } else {
        x = step % 2 === 0 ? x - 1 : x + 1;
        y = step % 2 === 0 ? y : upwards ? y - 1 : y + 1;
      }

      step++;
    }

    // Set remainder bits to 0.
    for (let y = 0; y < this.qrCode.length; y++) {
      for (let x = 0; x < this.qrCode.length; x++) {
        if (this.qrCode[y][x] === undefined) {
          this.qrCode[y][x] = new Module(false, true);
        }
      }
    }
  }

  applyDataMask() {
    let minScore = Number.MAX_VALUE;
    let minIndex = 0;
    let minQrCode: QrCode = [];

    for (let i = 0; i < 8; i++) {
      const qrCode = this.qrCode.map((row) => row.map((module) => ({ ...module })));

      for (let y = 0; y < qrCode.length; y++) {
        for (let x = 0; x < qrCode.length; x++) {
          if (qrCode[y][x].isCodeword && QrCodeGenerator.DATA_MASKS[i](x, y)) {
            qrCode[y][x].value = !qrCode[y][x].value;
          }
        }
      }

      const score = this.scoreDataMask(qrCode);
      if (score < minScore) {
        minScore = score;
        minIndex = i;
        minQrCode = qrCode;
      }
    }

    this.qrCode = minQrCode;
    return minIndex;
  }

  scoreDataMask(qrCode: QrCode) {
    let score = 0;

    let adjacent = 1;
    const scoreAdjacent = (x: number, y: number, row: boolean) => {
      const adjacentModule = row ? qrCode[y][x + 1] : qrCode[y + 1][x];
      const isLastModule = row ? x === qrCode.length - 2 : y === qrCode.length - 2;

      if (qrCode[y][x].value === adjacentModule.value) {
        adjacent++;
      }
      if (qrCode[y][x].value !== adjacentModule.value || isLastModule) {
        if (adjacent >= 5) {
          score += 3 + adjacent - 5;
        }
        adjacent = 1;
      }
    };

    // Adjacent modules in rows
    for (let y = 0; y < qrCode.length; y++) {
      for (let x = 0; x < qrCode.length - 1; x++) {
        scoreAdjacent(x, y, true);
      }
    }

    // Adjacent modules in columns
    for (let x = 0; x < qrCode.length; x++) {
      for (let y = 0; y < qrCode.length - 1; y++) {
        scoreAdjacent(x, y, false);
      }
    }

    // 2x2 modules
    for (let y = 0; y < qrCode.length - 1; y++) {
      for (let x = 0; x < qrCode.length - 1; x++) {
        const value = qrCode[y][x].value;
        if (
          qrCode[y + 1][x].value === value &&
          qrCode[y][x + 1].value === value &&
          qrCode[y + 1][x + 1].value === value
        ) {
          score += 3;
        }
      }
    }

    const patterns = [
      [false, false, false, false, true, false, true, true, true, false, true],
      [true, false, true, true, true, false, true, false, false, false, false],
    ];
    function score11311(x: number, y: number, row: boolean) {
      for (const pattern of patterns) {
        let matches = true;
        for (let i = 0; i < pattern.length; i++) {
          const value = row ? qrCode[y][x + i].value : qrCode[y + i][x].value;
          if (value !== pattern[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          score += 40;
        }
      }
    }

    // 1:1:3:1:1 pattern in rows
    for (let y = 0; y < qrCode.length; y++) {
      for (let x = 0; x < qrCode.length - 10; x++) {
        score11311(x, y, true);
      }
    }

    // 1:1:3:1:1 pattern in columns
    for (let x = 0; x < qrCode.length; x++) {
      for (let y = 0; y < qrCode.length - 10; y++) {
        score11311(x, y, false);
      }
    }

    // Proportion of modules
    let count = 0;
    for (let y = 0; y < qrCode.length; y++) {
      for (let x = 0; x < qrCode.length; x++) {
        if (qrCode[y][x].value) {
          count++;
        }
      }
    }

    const proportion = count / qrCode.length ** 2;
    score += 10 * Math.floor(Math.abs(proportion - 0.5) / 0.05);

    return score;
  }

  placeFormatInformation(bits: string) {
    for (let i = 0; i < 8; i++) {
      // Bits 14 to 7
      this.qrCode[8][i >= 6 ? i + 1 : i] = new Module(bits[i] === "1", false);
      this.qrCode[this.qrCode.length - i - 1][8] = new Module(bits[i] === "1", false);
      // Bits 7 to 0
      this.qrCode[i >= 6 ? i + 1 : i][8] = new Module(bits[14 - i] === "1", false);
      this.qrCode[8][this.qrCode.length - i - 1] = new Module(bits[14 - i] === "1", false);
    }

    // The dark module
    this.qrCode[this.qrCode.length - 8][8] = new Module(true, false);
  }

  placeVersionInformation(bits: string) {
    for (let i = 0; i < 18; i++) {
      this.qrCode[this.qrCode.length - 9 - (i % 3)][5 - Math.floor(i / 3)] = new Module(bits[i] === "1", false);
      this.qrCode[5 - Math.floor(i / 3)][this.qrCode.length - 9 - (i % 3)] = new Module(bits[i] === "1", false);
    }
  }

  static FINDER_PATTERN = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  static VERTICAL_SEPARATOR = ["0", "0", "0", "0", "0", "0", "0", "0"];
  static HORIZONTAL_SEPARATOR = ["00000000"];
  static ALIGNMENT_PATTERN = ["11111", "10001", "10101", "10001", "11111"];

  static ALIGNMENT_PATTERN_POSITIONS = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170],
  ];

  static DATA_CAPACITIES = [
    [152, 128, 104, 72],
    [272, 224, 176, 128],
    [440, 352, 272, 208],
    [640, 512, 384, 288],
    [864, 688, 496, 368],
    [1088, 864, 608, 480],
    [1248, 992, 704, 528],
    [1552, 1232, 880, 688],
    [1856, 1456, 1056, 800],
    [2192, 1728, 1232, 976],
    [2592, 2032, 1440, 1120],
    [2960, 2320, 1648, 1264],
    [3424, 2672, 1952, 1440],
    [3688, 2920, 2088, 1576],
    [4184, 3320, 2360, 1784],
    [4712, 3624, 2600, 2024],
    [5176, 4056, 2936, 2264],
    [5768, 4504, 3176, 2504],
    [6360, 5016, 3560, 2728],
    [6888, 5352, 3880, 3080],
    [7456, 5712, 4096, 3248],
    [8048, 6256, 4544, 3536],
    [8752, 6880, 4912, 3712],
    [9392, 7312, 5312, 4112],
    [10208, 8000, 5744, 4304],
    [10960, 8496, 6032, 4768],
    [11744, 9024, 6464, 5024],
    [12248, 9544, 6968, 5288],
    [13048, 10136, 7288, 5608],
    [13880, 10984, 7880, 5960],
    [14744, 11640, 8264, 6344],
    [15640, 12328, 8920, 6760],
    [16568, 13048, 9368, 7208],
    [17528, 13800, 9848, 7688],
    [18448, 14496, 10288, 7888],
    [19472, 15312, 10832, 8432],
    [20528, 15936, 11408, 8768],
    [21616, 16816, 12016, 9136],
    [22496, 17728, 12656, 9776],
    [23648, 18672, 13328, 10208],
  ];

  // prettier-ignore
  static DATA_CODEWORDS_PER_BLOCK = [
    [[19, 1, 0, 0], [16, 1, 0, 0], [13, 1, 0, 0], [9, 1, 0, 0]],
    [[34, 1, 0, 0], [28, 1, 0, 0], [22, 1, 0, 0], [16, 1, 0, 0]],
    [[55, 1, 0, 0], [44, 1, 0, 0], [17, 2, 0, 0], [13, 2, 0, 0]],
    [[80, 1, 0, 0], [32, 2, 0, 0], [24, 2, 0, 0], [9, 4, 0, 0]],
    [[108, 1, 0, 0], [43, 2, 0, 0], [15, 2, 16, 2], [11, 2, 12, 2]],
    [[68, 2, 0, 0], [27, 4, 0, 0], [19, 4, 0, 0], [15, 4, 0, 0]],
    [[78, 2, 0, 0], [31, 4, 0, 0], [14, 2, 15, 4], [13, 4, 14, 1]],
    [[97, 2, 0, 0], [38, 2, 39, 2], [18, 4, 19, 2], [14, 4, 15, 2]],
    [[116, 2, 0, 0], [36, 3, 37, 2], [16, 4, 17, 4], [12, 4, 13, 4]],
    [[68, 2, 69, 2], [43, 4, 44, 1], [19, 6, 20, 2], [15, 6, 16, 2]],
    [[81, 4, 0, 0], [50, 1, 51, 4], [22, 4, 23, 4], [12, 3, 13, 8]],
    [[92, 2, 93, 2], [36, 6, 37, 2], [20, 4, 21, 6], [14, 7, 15, 4]],
    [[107, 4, 0, 0], [37, 8, 38, 1], [20, 8, 21, 4], [11, 12, 12, 4]],
    [[115, 3, 116, 1], [40, 4, 41, 5], [16, 11, 17, 5], [12, 11, 13, 5]],
    [[87, 5, 88, 1], [41, 5, 42, 5], [24, 5, 25, 7], [12, 11, 13, 7]],
    [[98, 5, 99, 1], [45, 7, 46, 3], [19, 15, 20, 2], [15, 3, 16, 13]],
    [[107, 1, 108, 5], [46, 10, 47, 1], [22, 1, 23, 15], [14, 2, 15, 17]],
    [[120, 5, 121, 1], [43, 9, 44, 4], [22, 17, 23, 1], [14, 2, 15, 19]],
    [[113, 3, 114, 4], [44, 3, 45, 11], [21, 17, 22, 4], [13, 9, 14, 16]],
    [[107, 3, 108, 5], [41, 3, 42, 13], [24, 15, 25, 5], [15, 15, 16, 10]],
    [[116, 4, 117, 4], [42, 17, 0, 0], [22, 17, 23, 6], [16, 19, 17, 6]],
    [[111, 2, 112, 7], [46, 17, 0, 0], [24, 7, 25, 16], [13, 34, 0, 0]],
    [[121, 4, 122, 5], [47, 4, 48, 14], [24, 11, 25, 14], [15, 16, 16, 14]],
    [[117, 6, 118, 4], [45, 6, 46, 14], [24, 11, 25, 16], [16, 30, 17, 2]],
    [[106, 8, 107, 4], [47, 8, 48, 13], [24, 7, 25, 22], [15, 22, 16, 13]],
    [[114, 10, 115, 2], [46, 19, 47, 4], [22, 28, 23, 6], [16, 33, 17, 4]],
    [[122, 8, 123, 4], [45, 22, 46, 3], [23, 8, 24, 26], [15, 12, 16, 28]],
    [[117, 3, 118, 10], [45, 3, 46, 23], [24, 4, 25, 31], [15, 11, 16, 31]],
    [[116, 7, 117, 7], [45, 21, 46, 7], [23, 1, 24, 37], [15, 19, 16, 26]],
    [[115, 5, 116, 10], [47, 19, 48, 10], [24, 15, 25, 25], [15, 23, 16, 25]],
    [[115, 13, 116, 3], [46, 2, 47, 29], [24, 42, 25, 1], [15, 23, 16, 28]],
    [[115, 17, 0, 0], [46, 10, 47, 23], [24, 10, 25, 35], [15, 19, 16, 35]],
    [[115, 17, 116, 1], [46, 14, 47, 21], [24, 29, 25, 19], [15, 11, 16, 46]],
    [[115, 13, 116, 6], [46, 14, 47, 23], [24, 44, 25, 7], [16, 59, 17, 1]],
    [[121, 12, 122, 7], [47, 12, 48, 26], [24, 39, 25, 14], [15, 22, 16, 41]],
    [[121, 6, 122, 14], [47, 6, 48, 34], [24, 46, 25, 10], [15, 2, 16, 64]],
    [[122, 17, 123, 4], [46, 29, 47, 14], [24, 49, 25, 10], [15, 24, 16, 46]],
    [[122, 4, 123, 18], [46, 13, 47, 32], [24, 48, 25, 14], [15, 42, 16, 32]],
    [[117, 20, 118, 4], [47, 40, 48, 7], [24, 43, 25, 22], [15, 10, 16, 67]],
    [[118, 19, 119, 6], [47, 18, 48, 31], [24, 34, 25, 34], [15, 20, 16, 61]],
  ];

  static EC_CODEWORDS_PER_BLOCK = [
    [7, 10, 13, 17],
    [10, 16, 22, 28],
    [15, 26, 18, 22],
    [20, 18, 26, 16],
    [26, 24, 18, 22],
    [18, 16, 24, 28],
    [20, 18, 18, 26],
    [24, 22, 22, 26],
    [30, 22, 20, 24],
    [18, 26, 24, 28],
    [20, 30, 28, 24],
    [24, 22, 26, 28],
    [26, 22, 24, 22],
    [30, 24, 20, 24],
    [22, 24, 30, 24],
    [24, 28, 24, 30],
    [28, 28, 28, 28],
    [30, 26, 28, 28],
    [28, 26, 26, 26],
    [28, 26, 30, 28],
    [28, 26, 28, 30],
    [28, 28, 30, 24],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [26, 28, 30, 30],
    [28, 28, 28, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
    [30, 28, 30, 30],
  ];

  static GENERATOR_POLYNOMIALS: Uint8Array[];

  static DATA_MASKS = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  static FORMAT_INFORMATION = [
    "101010000010010",
    "101000100100101",
    "101111001111100",
    "101101101001011",
    "100010111111001",
    "100000011001110",
    "100111110010111",
    "100101010100000",
    "111011111000100",
    "111001011110011",
    "111110110101010",
    "111100010011101",
    "110011000101111",
    "110001100011000",
    "110110001000001",
    "110100101110110",
    "001011010001001",
    "001001110111110",
    "001110011100111",
    "001100111010000",
    "000011101100010",
    "000001001010101",
    "000110100001100",
    "000100000111011",
    "011010101011111",
    "011000001101000",
    "011111100110001",
    "011101000000110",
    "010010010110100",
    "010000110000011",
    "010111011011010",
    "010101111101101",
  ];

  static VERSION_INFORMATION = [
    "000111110010010100",
    "001000010110111100",
    "001001101010011001",
    "001010010011010011",
    "001011101111110110",
    "001100011101100010",
    "001101100001000111",
    "001110011000001101",
    "001111100100101000",
    "010000101101111000",
    "010001010001011101",
    "010010101000010111",
    "010011010100110010",
    "010100100110100110",
    "010101011010000011",
    "010110100011001001",
    "010111011111101100",
    "011000111011000100",
    "011001000111100001",
    "011010111110101011",
    "011011000010001110",
    "011100110000011010",
    "011101001100111111",
    "011110110101110101",
    "011111001001010000",
    "100000100111010101",
    "100001011011110000",
    "100010100010111010",
    "100011011110011111",
    "100100101100001011",
    "100101010000101110",
    "100110101001100100",
    "100111010101000001",
    "101000110001101001",
  ];
}

// Initialize the log and antilog tables.
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

let x = 1;
for (let i = 0; i < 255; i++) {
  EXP_TABLE[i] = x;
  LOG_TABLE[x] = i;

  x <<= 1;
  if (x >= 256) {
    x ^= 285;
  }
}

// Extend the antilog table so we won't need to modulo 255.
for (let i = 255; i < 512; i++) {
  EXP_TABLE[i] = EXP_TABLE[i - 255];
}

// Initialize generator polynomials.
QrCodeGenerator.GENERATOR_POLYNOMIALS = Array(68).fill(new Uint8Array());

for (let degree = 0; degree <= 68; degree++) {
  let g = new Uint8Array([1]);

  for (let i = 0; i < degree; i++) {
    g = polyMul(g, new Uint8Array([1, EXP_TABLE[i]]));
  }

  QrCodeGenerator.GENERATOR_POLYNOMIALS[degree] = g;
}

// Helper functions

// Multiplies two numbers in GF(256)
function gfMul(x: number, y: number) {
  // 0 has no log, return the result directly.
  if (x === 0 || y === 0) {
    return 0;
  }

  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

// Multiplies two polynomials whose coefficients are in GF(256)
function polyMul(p: Uint8Array, q: Uint8Array) {
  const product = new Uint8Array(p.length + q.length - 1);

  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      product[i + j] ^= gfMul(p[i], q[j]);
    }
  }

  return product;
}

// Finds the remainder of the division of two polynomials whose coefficients are in GF(256)
function polyMod(dividend: Uint8Array, divisor: Uint8Array) {
  let remainder = new Uint8Array(dividend);

  while (remainder.length >= divisor.length) {
    const leading_coeff = remainder[0];

    for (let i = 0; i < divisor.length; i++) {
      remainder[i] ^= gfMul(divisor[i], leading_coeff);
    }

    // Remove leading zeros.
    let i = 0;
    while (i < remainder.length && remainder[i] === 0) {
      i++;
    }
    remainder = remainder.slice(i);
  }

  return remainder;
}
