// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppShellUserMenu } from '../app-shell';
import { ProfileImageEditor } from '../profile-image-editor';

afterEach(cleanup);

/** The avatar fallback of a rendered tree: its text and whether it shows the person icon. */
function avatarFallback(container: HTMLElement) {
  const fallback = container.querySelector('[data-slot="avatar-fallback"]');
  return {
    text: fallback?.textContent ?? '',
    hasPersonIcon: fallback?.querySelector('svg.lucide-user-round') != null,
  };
}

describe('avatars of an unnamed phone-only account', () => {
  it('the account menu shows a person icon instead of an empty circle', () => {
    const { container } = render(
      <AppShellUserMenu
        trigger="avatar"
        user={{ name: '', secondaryLabel: '+91 98765 43210' }}
        onLogout={() => {}}
      />,
    );
    expect(avatarFallback(container)).toEqual({ text: '', hasPersonIcon: true });
  });

  it('the profile image editor shows a person icon instead of an empty circle', () => {
    const { container } = render(<ProfileImageEditor name="" canEdit={false} />);
    expect(avatarFallback(container)).toEqual({ text: '', hasPersonIcon: true });
  });

  it('named people keep their initials', () => {
    const { container } = render(<ProfileImageEditor name="Asha Rao" canEdit={false} />);
    expect(avatarFallback(container)).toEqual({ text: 'AR', hasPersonIcon: false });
  });
});
