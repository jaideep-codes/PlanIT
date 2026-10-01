import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from './button';

afterEach(cleanup);

describe('Button', () => {
  it('renders a native button with the default variant', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.className).toContain('bg-primary');
  });

  it('lets a caller override conflicting utilities', () => {
    render(<Button className="h-12">Tall</Button>);
    const button = screen.getByRole('button', { name: 'Tall' });
    expect(button.className).toContain('h-12');
    expect(button.className).not.toContain('h-9');
  });

  it('renders its child element when asChild is set', () => {
    render(
      <Button asChild variant="outline">
        <a href="/settings">Settings</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Settings' });
    expect(link.getAttribute('href')).toBe('/settings');
    expect(link.className).toContain('border');
  });
});
