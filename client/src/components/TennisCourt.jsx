export default function TennisCourt({ type, children }) {
  return <div className={`tennis-court ${type === 'Clay' ? 'tennis-court-clay' : ''}`}>
    <svg className="court-lines" viewBox="0 0 400 220" preserveAspectRatio="none" fill="none" aria-hidden="true"><rect x="16" y="14" width="368" height="192" /><path d="M16 40h368M16 180h368M114 40v140M286 40v140M114 110h172M16 110h6m356 0h6" /><path className="court-net" d="M200 6v208" /></svg>
    <div className="court-players">{children}</div>
  </div>;
}
