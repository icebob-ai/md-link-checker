# Local Links Test

This file tests local file link resolution relative to this file's location.

## Relative Links

[Valid: broken fixture](broken.md)

[Valid: valid fixture](valid.md)

## Relative with subdirectory notation

[Self reference](local-links.md)

## Anchor Only

[Jump to section](#relative-links)

## Image Links

![Image pointing to valid](valid.md)

## Reference-style local

[ref link][local-ref]

[local-ref]: broken.md
