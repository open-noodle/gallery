import { createZodDto } from 'nestjs-zod';
import z from 'zod';

// -100..100 with 0 as "unchanged", the slider range of the web editor's Adjust panel. Each maps onto the CSS filter
// function of the same name (see src/gallery/utils/image-adjust.ts), which is what the editor previews with.
const amount = (description: string) => z.number().meta({ format: 'double' }).min(-100).max(100).describe(description);

const AssetImageAdjustSchema = z
  .object({
    exposure: amount('Exposure, -100 to 100 (CSS brightness, 0 = unchanged)').default(0),
    contrast: amount('Contrast, -100 to 100 (CSS contrast, 0 = unchanged)').default(0),
    saturation: amount('Saturation, -100 to 100 (CSS saturate, 0 = unchanged)').default(0),
    invert: z.boolean().default(false).describe('Invert the colours, for scanned film negatives'),
  })
  .meta({ id: 'AssetImageAdjustDto' });

const AssetImageAdjustResponseSchema = z
  .object({
    exposure: amount('Exposure, -100 to 100 (CSS brightness, 0 = unchanged)'),
    contrast: amount('Contrast, -100 to 100 (CSS contrast, 0 = unchanged)'),
    saturation: amount('Saturation, -100 to 100 (CSS saturate, 0 = unchanged)'),
    invert: z.boolean().describe('Invert the colours, for scanned film negatives'),
  })
  .meta({ id: 'AssetImageAdjustResponseDto' });

export class AssetImageAdjustDto extends createZodDto(AssetImageAdjustSchema) {}
export class AssetImageAdjustResponseDto extends createZodDto(AssetImageAdjustResponseSchema) {}

export type ImageAdjust = z.infer<typeof AssetImageAdjustResponseSchema>;

export const NEUTRAL_IMAGE_ADJUST: ImageAdjust = Object.freeze({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  invert: false,
});

export const isNeutralImageAdjust = ({ exposure, contrast, saturation, invert }: ImageAdjust) =>
  exposure === 0 && contrast === 0 && saturation === 0 && !invert;
