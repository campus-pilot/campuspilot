// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CadetNoticeDocument, CadetNoticeList, CadetNoticeText, cadetNoticeParagraphs } from './cadet-notice';

afterEach(() => cleanup());

describe('cadetNoticeParagraphs', () => {
  it('splits at blank lines, keeps single line breaks and drops empty paragraphs, like the printed notice', () => {
    expect(cadetNoticeParagraphs('First line\nsecond line\n\n\n  \nSecond paragraph  \r\n\r\nThird')).toEqual(['First line\nsecond line', 'Second paragraph', 'Third']);
    expect(cadetNoticeParagraphs('   \n\n  ')).toEqual([]);
  });
});

describe('CadetNoticeText', () => {
  it('shows each paragraph as text, never as markup', () => {
    const { container } = render(<CadetNoticeText text={'School reopens on Monday.\nBuses run as usual.\n\n<b>Bring</b> {{school.name}}'} />);
    const paragraphs = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['School reopens on Monday.\nBuses run as usual.', '<b>Bring</b> {{school.name}}']);
    expect(container.querySelector('b')).toBeNull();
  });

  it('says so when a notice has no text', () => {
    render(<CadetNoticeText text={'  \n '} />);
    expect(screen.getByText('This notice has no text.')).toBeTruthy();
  });
});

describe('CadetNoticeDocument', () => {
  it('shows the rendered notice in an empty sandbox', () => {
    render(<CadetNoticeDocument html="<p>Sports Day</p>" />);
    const frame = screen.getByTitle('Notice as printed') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>Sports Day</p>');
    expect(screen.getByText(/Download the PDF to zoom in/)).toBeTruthy();
  });
});

describe('CadetNoticeList', () => {
  it('links every notice through the app-supplied link', () => {
    render(
      <CadetNoticeList
        entries={[
          { noticeId: 'ntc_1', title: 'Winter uniform', detail: '3 Nov 2026', href: '/notices/ntc_1' },
          { noticeId: 'ntc_2', title: 'Sports Day', detail: '24 Oct 2026', href: '/notices/ntc_2' },
        ]}
        renderLink={({ href, className, children }) => <a href={href} className={className}>{children}</a>}
      />,
    );
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/notices/ntc_1', '/notices/ntc_2']);
    expect(screen.getByRole('link', { name: /Winter uniform/ }).textContent).toContain('3 Nov 2026');
  });
});
