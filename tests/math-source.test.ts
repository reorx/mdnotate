import { describe, expect, it } from 'vitest';
import { hasMath, normalizeMathDelimiters } from '../src/lib/math-source';

describe('hasMath', () => {
  it('finds every shape the renderer would typeset', () => {
    expect(hasMath('the value $x$ here')).toBe(true);
    expect(hasMath('a\n\n$$\nE = mc^2\n$$\n\nb')).toBe(true);
    expect(hasMath('inline \\(a+b\\) here')).toBe(true);
    expect(hasMath('display \\[a+b\\] here')).toBe(true);
    expect(hasMath('```math\na+b\n```')).toBe(true);
  });

  it('is not fooled by a lone dollar sign', () => {
    expect(hasMath('it costs $5 per day')).toBe(false);
    expect(hasMath('# Title\n\nordinary prose')).toBe(false);
    expect(hasMath('')).toBe(false);
  });

  it('says yes to two amounts on one line, because the renderer says yes too', () => {
    // `$5 and saves $10` really does typeset as a formula while single-dollar
    // math is on. Saying no here would be the lie.
    expect(hasMath('it costs $5 and saves $10')).toBe(true);
  });
});

describe('normalizeMathDelimiters', () => {
  describe('LaTeX delimiters', () => {
    it('rewrites inline \\(…\\) to $…$', () => {
      expect(normalizeMathDelimiters('Inline latex \\(a+b\\) here.')).toBe('Inline latex $a+b$ here.');
    });

    it('rewrites display \\[…\\] to $$…$$', () => {
      expect(normalizeMathDelimiters('\\[ a+b \\]')).toBe('$$\n a+b \n$$');
    });

    it('rewrites a \\[…\\] already spread over lines', () => {
      const input = ['Before', '', '\\[', 'E = mc^2', '\\]', '', 'After'].join('\n');
      const out = normalizeMathDelimiters(input);
      expect(out.split('\n')).toEqual(['Before', '', '$$', 'E = mc^2', '$$', '', 'After']);
    });

    it('rewrites several formulas on one line', () => {
      expect(normalizeMathDelimiters('Both \\(a\\) and \\(b\\) hold.')).toBe('Both $a$ and $b$ hold.');
    });

    it('leaves an escaped backslash alone', () => {
      // `\\(` is a literal backslash then a paren, not a math delimiter — the
      // row separator of a matrix followed by a bracket looks exactly like this.
      expect(normalizeMathDelimiters('a \\\\(b) c')).toBe('a \\\\(b) c');
    });

    it('leaves an unpaired opening delimiter alone', () => {
      expect(normalizeMathDelimiters('An aside \\(unclosed here.')).toBe('An aside \\(unclosed here.');
      expect(normalizeMathDelimiters('Before \\[ unclosed.')).toBe('Before \\[ unclosed.');
    });

    it('leaves an empty formula alone', () => {
      expect(normalizeMathDelimiters('nothing \\(\\) here')).toBe('nothing \\(\\) here');
    });
  });

  describe('whole-line $$…$$', () => {
    // remark-math reads `$$x$$` written on one line as *inline* math, because
    // its flow construct wants the fence on a line of its own. Everyone else —
    // LaTeX, Pandoc, MathJax — reads it as display math, and KaTeX refuses
    // `\begin{align}` outside display mode, so the difference is visible.
    it('spreads a line that is nothing but $$…$$ onto its own fence', () => {
      expect(normalizeMathDelimiters('$$E = mc^2$$')).toBe('$$\nE = mc^2\n$$');
    });

    it('keeps the leading indent and quote markers on every line', () => {
      expect(normalizeMathDelimiters('> $$E = mc^2$$')).toBe('> $$\n> E = mc^2\n> $$');
      expect(normalizeMathDelimiters('  $$E = mc^2$$')).toBe('  $$\n  E = mc^2\n  $$');
    });

    it('leaves $$…$$ sitting inside a sentence inline', () => {
      expect(normalizeMathDelimiters('The value $$a$$ is here.')).toBe('The value $$a$$ is here.');
    });

    it('leaves an already-fenced block alone', () => {
      const input = ['$$', '\\begin{aligned}', 'a &= b', '\\end{aligned}', '$$'].join('\n');
      expect(normalizeMathDelimiters(input)).toBe(input);
    });

    it('leaves a bare fence line alone', () => {
      expect(normalizeMathDelimiters('$$')).toBe('$$');
      expect(normalizeMathDelimiters('$$$$')).toBe('$$$$');
    });

    it('does not split a line holding two separate formulas', () => {
      expect(normalizeMathDelimiters('$$a$$ and $$b$$')).toBe('$$a$$ and $$b$$');
    });

    it('spreads a \\[…\\] line, having rewritten it first', () => {
      expect(normalizeMathDelimiters('\\[\\begin{align} a &= b \\end{align}\\]')).toBe(
        '$$\n\\begin{align} a &= b \\end{align}\n$$',
      );
    });
  });

  describe('code is left exactly as written', () => {
    it('leaves a fenced code block alone', () => {
      const input = ['```tex', '\\(a+b\\)', '$$x$$', '```'].join('\n');
      expect(normalizeMathDelimiters(input)).toBe(input);
    });

    it('leaves a tilde-fenced block alone', () => {
      const input = ['~~~', '\\[a\\]', '~~~'].join('\n');
      expect(normalizeMathDelimiters(input)).toBe(input);
    });

    it('resumes rewriting after the fence closes', () => {
      const input = ['```', '\\(a\\)', '```', '', 'Then \\(b\\).'].join('\n');
      const out = normalizeMathDelimiters(input);
      expect(out.split('\n')).toEqual(['```', '\\(a\\)', '```', '', 'Then $b$.']);
    });

    it('leaves an inline code span alone', () => {
      expect(normalizeMathDelimiters('Write `\\(a\\)` for inline math.')).toBe('Write `\\(a\\)` for inline math.');
    });

    it('rewrites around an inline code span', () => {
      expect(normalizeMathDelimiters('Use `\\(` to open \\(a\\) math.')).toBe('Use `\\(` to open $a$ math.');
    });

    it('leaves a double-backtick span alone', () => {
      expect(normalizeMathDelimiters('``a \\(b\\) c``')).toBe('``a \\(b\\) c``');
    });

    it('treats an unclosed backtick as ordinary text', () => {
      // CommonMark does: a lone backtick opens nothing.
      expect(normalizeMathDelimiters('a ` b \\(c\\) d')).toBe('a ` b $c$ d');
    });
  });

  describe('documents with no math', () => {
    it('returns prose untouched', () => {
      const input = ['# Title', '', 'Some prose with $5 and $10 in it.', '', '- a list'].join('\n');
      expect(normalizeMathDelimiters(input)).toBe(input);
    });

    it('preserves a trailing newline', () => {
      expect(normalizeMathDelimiters('text\n')).toBe('text\n');
    });
  });
});
