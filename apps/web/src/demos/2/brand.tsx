/** Logo mark from `/icon.svg` plus the wordmark. Decorative image: the parent link carries the label. */
export function BrandMark() {
  return (
    <span className="d2-brand-mark">
      <img src="/icon.svg" alt="" width={28} height={28} />
      <span className="d2-brand-word">CampusPilot</span>
    </span>
  );
}
