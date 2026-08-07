// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ThemeToggle } from '@/app/_components/ThemeToggle';

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  localStorage.clear();
  document.cookie = 'cnw-theme=; path=/; max-age=0';
});
afterEach(() => vi.restoreAllMocks());

describe('ThemeToggle', () => {
  it('renders three options when clicked', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /主题/i }));
    // 亮/暗 appear only in the dropdown items. 系统 appears both in the
    // toggle button (default theme label) and the dropdown item, so use
    // getAllByText and verify at least one match.
    expect(screen.getByText(/亮/)).toBeTruthy();
    expect(screen.getByText(/暗/)).toBeTruthy();
    expect(screen.getAllByText(/系统/).length).toBeGreaterThan(0);
  });

  it('applies .dark class and persists cookie + localStorage when 暗 chosen', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /主题/i }));
    fireEvent.click(screen.getByText(/暗/));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('cnw-theme')).toBe('dark');
    expect(document.cookie).toContain('cnw-theme=dark');
  });

  it('removes .dark class and clears theme when 亮 chosen', () => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('cnw-theme', 'dark');
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /主题/i }));
    fireEvent.click(screen.getByText(/亮/));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('cnw-theme')).toBe('light');
  });
});