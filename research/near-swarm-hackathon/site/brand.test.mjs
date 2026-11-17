import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

// Pin the approved transparent wordmark so an opaque banner cannot replace it.
const wordmarkHash = '2d926a5fb7bbccc49474c271d037933c4a3d308d62f81950885108112761f105';

for (const page of ['index.html', 'landing.html']) {
  test(`${page} embeds the transparent wordmark at its original aspect ratio`, async () => {
    const html = await readFile(new URL(page, import.meta.url), 'utf8');
    const match = html.match(/<img class="brand" src="data:image\/png;base64,([A-Za-z0-9+/=]+)" width="381" height="55" alt="MultiHopper">/);
    assert.ok(match, 'The wordmark must load directly with the page and reserve its dimensions');
    const png = Buffer.from(match[1], 'base64');
    assert.equal(createHash('sha256').update(png).digest('hex'), wordmarkHash);
    assert.equal(png.readUInt32BE(16), 381);
    assert.equal(png.readUInt32BE(20), 55);
    assert.equal(png[25], 6, 'The wordmark must retain its RGBA transparency');
    assert.match(html, /\.brand\{display:block;width:190px;max-width:100%;height:auto\}/);
  });
}
