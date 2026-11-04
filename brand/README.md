# CampusPilot brand assets

Copy-ready logo files for every CampusPilot app. Each product has the same set of
files, so an app picks its product folder and copies what it needs.

| Folder | Product | Mark |
| --- | --- | --- |
| [`campuspilot/`](campuspilot/) | CampusPilot (management app, website) | The open C with a graduation cap |
| [`admin/`](admin/) | CampusPilot Admin | The open C with an administration building |

## Files in each product folder

| File | Use it for |
| --- | --- |
| `mark.svg` | Inline use in code. Drawn in `currentColor`, so it follows the surrounding text colour and flips with the theme. |
| `mark-mono-light.svg` | The mark on **light** backgrounds (near-black ink `#111110`). |
| `mark-mono-dark.svg` | The mark on **dark** backgrounds (white). |
| `lockup-mono-light.svg` | Mark plus wordmark on **light** backgrounds. The text is outlined, so no font is needed. |
| `lockup-mono-dark.svg` | Mark plus wordmark on **dark** backgrounds. |
| `app-icon.svg` | App icon: white mark on the primary orange (`#c2580e`), rounded tile. |
| `app-icon-192.png`, `app-icon-512.png` | Web app manifest icons. |
| `apple-touch-icon.png` | iOS home screen (180 × 180, full-bleed square; iOS rounds the corners itself). |
| `small-icon.svg` | Favicon in SVG. Same tile as the app icon with a larger mark, so it stays readable at 16–32 px. |
| `small-icon-16.png`, `small-icon-32.png` | Raster favicons. |
| `favicon.ico` | Legacy favicon containing 16, 32 and 48 px images. |

## Rules

- The logo uses one colour at a time: near-black on light, white on dark, or white on the
  primary orange for app icons. There is no two-colour version.
- Keep clear space around the mark of at least the width of the C's stroke.
- The wordmark is Geist SemiBold with −0.02em tracking. In the admin lockup, "Admin" is
  Geist Regular.

## Using the assets in an app

- **Next.js apps** (`apps/management`, `apps/admin`): put `small-icon.svg` in `app/` as
  `icon.svg`, `favicon.ico` as `app/favicon.ico`, and `apple-touch-icon.png` as
  `app/apple-icon.png`. Next.js adds the `<link>` tags.
- **Static sites** (`apps/web`): copy the files into `public/` and link them from the
  document head.
- **React UI**: use `BrandMark` / `BrandLogo` from `@campuspilot/components/brand-logo`.
  They draw the same geometry inline in `currentColor` and take a required `product`.

The same mark geometry lives in `@campuspilot/components/brand-logo.tsx`. If you change
a mark, update both places.
