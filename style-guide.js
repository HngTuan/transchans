/* style-guide.js
 * Skill: writing-clearly-and-concisely
 * Nguon: William Strunk Jr., "The Elements of Style" (1918) - public domain
 *        https://github.com/obra/the-elements-of-style
 *
 * Ban goc cua skill nay yeu cau agent doc ca cuon sach (~12.000 token) truoc khi
 * viet. Voi VisionBox, moi anh la 1 request rieng nen chi phi do se nhan len rat
 * nhanh. Vi vay o day skill duoc co dong lai thanh 1 khoi rule (~450 token) chi
 * giu nhung dieu THUC SU tac dong den chat luong 1 dong thoai truyen tranh, va
 * bo sung phan "ngoai le hoi thoai" - phan quan trong nhat, vi Strunk viet cho
 * van xuoi trang trong, khong phai cho loi thoai nhan vat.
 *
 * Muon dung ban day du 12k token: gan window.STYLE_SKILL.customBlock = "<noi dung>"
 * (xem ham buildBlock ben duoi), khoi phai sua cho nao khac.
 */
(() => {
  const VERSION = 'strunk-1918-condensed-v1';

  // ---------- phan rule dung chung cho ca Translate va Refine Translation ----------
  function coreRules(targetName) {
    return `--- STYLE GUIDE: "The Elements of Style" (Strunk, 1918), adapted for comic translation ---
Apply the rules below to EVERY line you write in ${targetName}. They govern HOW each line is worded. They NEVER override the line-count, line-order, or meaning requirements stated earlier in this prompt - if a style rule would force you to merge, split, drop, or alter the meaning of a line, ignore that style rule for that line.

A. RULES TO APPLY
1. Omit needless words. Every word must do work. Cut filler, padding and redundant modifiers ("the fact that", "in order to", "it is possible that", "a certain kind of"...). Of two lines with identical meaning, always choose the shorter one - it also fits inside a speech bubble better.
2. Use the active voice. "He was defeated by them" -> "They defeated him". Passive phrasing is weaker and longer.
3. Put statements in positive form. Say what something IS, not what it is not: "did not remember" -> "forgot"; "was not honest" -> "lied".
4. Use definite, specific, concrete language. Prefer the concrete noun and the vivid verb over vague abstractions.
5. Keep related words together: subject next to its verb, each modifier next to the thing it modifies, so the line reads correctly on the first pass.
6. Place the emphatic word at the END of the line. The last word of a bubble lands hardest - put the punchline, the name, the threat or the reveal there whenever ${targetName} grammar allows it.
7. Express co-ordinate ideas in similar form (parallel structure), especially in lists, chants, oaths and repeated phrases.
8. Keep to ONE tense inside a narration/caption box; do not drift between past and present.
9. Do not join two independent clauses with only a comma, and do not break one sentence into two fragments without reason.

B. NATURAL-SPEECH EXCEPTIONS (these WIN whenever they conflict with section A)
10. This is comic DIALOGUE, not an essay. Preserve each character's voice: slang stays slang, rude stays rude, childish stays childish, archaic stays archaic, polite stays polite.
11. Keep deliberate speech features: stammering, cut-off sentences, trailing sounds, interjections, verbal tics, catchphrases, and words repeated for emphasis. These are NOT "needless words" - never delete them.
12. Never sacrifice meaning, nuance, emotion, or a form of address / honorific just to make a line shorter.
13. Never turn a casual spoken line into stiff, formal or literary prose. Here "clear and concise" means natural and tight, never bookish.

C. AVOID
14. Avoid translationese: literal calques no native ${targetName} speaker would ever say.
15. Avoid inflated connectors and ready-made padding ("moreover", "furthermore", "it can be said that"...) where a plain word - or no word at all - does the job.`;
  }

  // ---------- phan chi danh cho luot Refine Translation ----------
  const REFINE_EXTRA = `
D. FOR THIS REFINEMENT PASS
16. Actively REWRITE any previous line that breaks a rule above, even if its meaning was already correct. A wordy, passive, vague or stiff line is a line that still needs fixing.
17. Leave a line untouched only when it is BOTH correct in meaning AND already clean under these rules.`;

  window.STYLE_SKILL = {
    id: 'writing-clearly-and-concisely',
    version: VERSION,
    // Gan chuoi vao day de thay hoan toan khoi rule mac dinh (vi du: dan ca
    // ban 12k token cua elements-of-style.md). De null = dung ban co dong.
    customBlock: null,

    /**
     * @param {string} targetName - ten ngon ngu dich, vd "Vietnamese"
     * @param {'translate'|'refine'} mode
     * @returns {string} khoi text chen thang vao prompt
     */
    buildBlock(targetName, mode = 'translate') {
      if (typeof this.customBlock === 'string' && this.customBlock.trim()) {
        return this.customBlock;
      }
      const block = coreRules(targetName || 'the target language');
      return mode === 'refine' ? block + '\n' + REFINE_EXTRA : block;
    }
  };
})();
