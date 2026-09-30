import type { Engine, ModuleLogic } from "../engine/engine";

const TIME_CARD_ICON = 0;
const PRINT = 1;
const ACTIVITY_ICON = 4;
const CONGRATULATIONS = 3;
const MASTER_CERTIFICATE = 68;
const FONT_FAMILY = "Arial, Helvetica, sans-serif";

interface NameLayer {
  dx: number;
  y: number;
  color: string;
}

interface NameStyle {
  size: number;
  boxLeft: number;
  boxWidth: number;
  layers: NameLayer[];
}

function layer(dx: number, y: number, color: string): NameLayer {
  return { dx, y, color };
}

const STYLES = new Map<number, NameStyle>([
  [
    61,
    {
      size: 40,
      boxLeft: 148,
      boxWidth: 340,
      layers: [layer(3, 254, "#FEFDFA"), layer(0, 251, "#000000"), layer(1, 252, "#BD2900")],
    },
  ],
  [62, { size: 48, boxLeft: 282, boxWidth: 280, layers: [layer(0, 90, "#FFFFFF")] }],
  [63, { size: 54, boxLeft: 160, boxWidth: 312, layers: [layer(0, 202, "#FFFFFF")] }],
  [
    64,
    {
      size: 44,
      boxLeft: 146,
      boxWidth: 350,
      layers: [layer(2, 196, "#CEAF40"), layer(0, 194, "#18085A")],
    },
  ],
  [
    65,
    {
      size: 48,
      boxLeft: 140,
      boxWidth: 350,
      layers: [layer(3, 39, "#FFFFD6"), layer(0, 36, "#090909"), layer(1, 37, "#90373B")],
    },
  ],
  [
    66,
    {
      size: 48,
      boxLeft: 152,
      boxWidth: 350,
      layers: [layer(3, 189, "#FFFFD6"), layer(0, 186, "#874700"), layer(1, 187, "#B37B40")],
    },
  ],
  [
    67,
    {
      size: 48,
      boxLeft: 200,
      boxWidth: 255,
      layers: [layer(3, 165, "#FFFFD6"), layer(0, 162, "#000000"), layer(1, 163, "#214A4A")],
    },
  ],
  [
    68,
    {
      size: 48,
      boxLeft: 200,
      boxWidth: 255,
      layers: [layer(3, 205, "#F6D031"), layer(0, 202, "#000000"), layer(1, 203, "#943900")],
    },
  ],
]);

function drawName(engine: Engine): void {
  const style = STYLES.get(engine.moduleNumber);

  if (!style) {
    return;
  }

  const centreX = style.boxLeft + style.boxWidth / 2;
  const font = `bold ${style.size}px ${FONT_FAMILY}`;

  style.layers.forEach((nameLayer, index) => {
    const x = centreX + nameLayer.dx;

    engine.framebuffer.overlays.set(`name${index}`, {
      text: engine.playerName,
      x,
      y: nameLayer.y,
      font,
      color: nameLayer.color,
      align: "center",
    });
  });
}

function enter(engine: Engine): number | undefined {
  const seen = engine.progress.certificatesSeen;
  const firstMasterVisit =
    engine.moduleNumber === MASTER_CERTIFICATE && !seen.includes(MASTER_CERTIFICATE);

  if (!seen.includes(engine.moduleNumber)) {
    seen.push(engine.moduleNumber);
  }

  drawName(engine);

  if (firstMasterVisit) {
    engine.requireScene().objects[CONGRATULATIONS].finished = false;
  }

  return undefined;
}

async function clickPrint(engine: Engine): Promise<void> {
  await engine.sfx("btnclik1");
  engine.hide(TIME_CARD_ICON);
  engine.hide(PRINT);
  engine.hide(ACTIVITY_ICON);
  engine.printScreen();
  engine.show(TIME_CARD_ICON);
  engine.show(PRINT);
  engine.show(ACTIVITY_ICON);
}

function click(engine: Engine, object: number): void {
  if (object === PRINT) {
    clickPrint(engine).catch(() => undefined);
  }
}

export const certificate: ModuleLogic = {
  enter,
  click,
  backTarget: () => 13,
};
