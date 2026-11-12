/**
Asset versions (specs/2026-11-07-asset-versions-design.md): the two instructions a person gives a file, read by the
real ExifTool from files written the way photo programs write them. The service's tests mock ExifTool; this one
checks the field names and forms those tests assume.
*/
import { Kysely } from 'kysely';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instructionsOf, toCaptureSignature } from 'src/gallery/utils/asset-version-signature.js';
import { MetadataRepository } from 'src/repositories/metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { ExifTestContext, testAssetsDir } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
let folder: string;

beforeAll(async () => {
  database = await getKyselyDB();
  folder = await mkdtemp(join(tmpdir(), 'gallery-versions-'));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

const metadata = () => new ExifTestContext(database).get(MetadataRepository);

/** An XMP sidecar as Lightroom Classic writes one for a RAW, with these Instructions. */
const sidecar = (instructions: string) => `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    photoshop:Instructions="${instructions}">
   <dc:subject><rdf:Bag><rdf:li>noodle-gallery:keep-apart-as-a-keyword</rdf:li></rdf:Bag></dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;

describe('the instructions, read by ExifTool', () => {
  it('reads them from an XMP sidecar, one per line, and leaves its keywords alone', async () => {
    const path = join(folder, 'DSC_0001.NEF.xmp');
    await writeFile(path, sidecar('print 20x30&#xA;noodle-gallery:keep-apart'));

    const tags = (await metadata().readTags(path)) as Record<string, unknown>;

    expect(instructionsOf(tags)).toEqual(['print 20x30', 'noodle-gallery:keep-apart']);
    expect(toCaptureSignature({}, 'DSC_0001.NEF', instructionsOf(tags)).keepApart).toBe(true);
  });

  it('reads them from a JPEG, in both forms of the field a program writes', async () => {
    const path = join(folder, 'glare-fix.jpg');
    await copyFile(resolve(testAssetsDir, 'metadata/tags/picasa.jpg'), path);
    await metadata().writeTags(path, {
      SpecialInstructions: 'noodle-gallery:version-of=DSC_0001.JPG',
      Instructions: 'noodle-gallery:version-of=DSC_0001.JPG',
    } as never);

    const tags = (await metadata().readTags(path)) as Record<string, unknown>;

    expect(tags).toMatchObject({
      SpecialInstructions: 'noodle-gallery:version-of=DSC_0001.JPG',
      Instructions: 'noodle-gallery:version-of=DSC_0001.JPG',
    });
    expect(toCaptureSignature(tags, 'glare-fix.jpg')).toMatchObject({
      sourceFileNames: ['DSC_0001.JPG'],
      sourceFromInstruction: true,
      isEdit: true,
      keepApart: false,
    });
  });
});
