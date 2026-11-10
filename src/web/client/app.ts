/**
 * Typed browser interaction for the v1 Hamtaraz upload UI. The server repeats
 * all validation and always enforces ENHANCED mode. No financial logic runs here.
 */
((): void => {
  const form = document.querySelector<HTMLFormElement>('#reconcile-form');
  if (!form) return;
  const bank = form.querySelector<HTMLInputElement>('input[name="bankFile"]');
  const tbs = form.querySelector<HTMLInputElement>('input[name="tbsFile"]');
  const errorBox = document.querySelector<HTMLElement>('#file-error');
  const submit = document.querySelector<HTMLButtonElement>('#submit-reconcile');
  if (!bank || !tbs || !submit) return;
  const limit = 25 * 1024 * 1024;

  function prettySize(bytes: number): string {
    return bytes >= 1_048_576
      ? `${(bytes / 1_048_576).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت`
      : `${Math.max(1, Math.ceil(bytes / 1024)).toLocaleString('fa-IR')} کیلوبایت`;
  }
  function checkFile(file: File | undefined): string {
    if (!file) return '';
    if (!/\.xlsx$/i.test(file.name)) return 'فقط فایل Excel با پسوند xlsx مجاز است.';
    if (file.size > limit) return 'حجم هر فایل باید حداکثر ۲۵ مگابایت باشد.';
    return '';
  }
  function setError(message: string): void {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.toggle('hidden', !message);
  }
  function showFile(input: HTMLInputElement): void {
    const card = input.closest<HTMLElement>('.upload-card');
    if (!card) return;
    const file = input.files?.[0], problem = checkFile(file);
    card.classList.toggle('has-file', Boolean(file) && !problem);
    card.classList.toggle('has-error', Boolean(problem));
    const name = card.querySelector<HTMLElement>('.file-name');
    if (name) name.textContent = !file ? 'هنوز فایلی انتخاب نشده' : problem || `${file.name} · ${prettySize(file.size)}`;
    setError('');
  }
  for (const input of [bank, tbs]) {
    const card = input.closest<HTMLElement>('.upload-card');
    input.addEventListener('change', () => showFile(input));
    card?.addEventListener('dragover', event => { event.preventDefault();card.classList.add('dragover'); });
    card?.addEventListener('dragleave', event => {
      if (!card.contains(event.relatedTarget as Node)) card.classList.remove('dragover');
    });
    card?.addEventListener('drop', event => {
      event.preventDefault();card.classList.remove('dragover');
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      const selection = new DataTransfer();selection.items.add(file);
      input.files = selection.files;showFile(input);
    });
  }
  form.addEventListener('submit', event => {
    const error = !bank.files?.length || !tbs.files?.length
      ? 'لطفاً هر دو گزارش بانک ملی و TBS را انتخاب کنید.'
      : checkFile(bank.files[0]) || checkFile(tbs.files[0]);
    if (error) {event.preventDefault();setError(error);return;}
    submit.disabled = true;submit.classList.add('loading');
    const text=submit.querySelector<HTMLElement>('.btn-label');if(text) text.textContent='در حال بررسی فایل‌ها…';
  });
})();
