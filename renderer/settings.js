const btnClose = document.getElementById('btn-close');
const btnSave = document.getElementById('btn-save');
const inputSystem = document.getElementById('input-system');
const inputKeywords = document.getElementById('input-keywords');
const inputBrief = document.getElementById('input-brief');
const inputSummary = document.getElementById('input-summary');

// Load initial data
async function load() {
  try {
    const prompts = await window.sunshadeAPI.loadCustomPrompts();
    if (prompts) {
      inputSystem.value = prompts.system || '';
      if (prompts.sections) {
        inputKeywords.value = prompts.sections.keywords || '';
        inputBrief.value = prompts.sections.brief || '';
        inputSummary.value = prompts.sections.summary || '';
      }
    }
  } catch (err) {
    console.error('Failed to load settings', err);
    alert('설정을 불러오는데 실패했습니다.');
  }
}

// Save data
async function save() {
  btnSave.textContent = '저장 중...';
  btnSave.disabled = true;
  
  const data = {
    system: inputSystem.value,
    sections: {
      keywords: inputKeywords.value,
      brief: inputBrief.value,
      summary: inputSummary.value
    }
  };

  try {
    await window.sunshadeAPI.savePrompts(data);
    btnSave.textContent = '저장됨';
    setTimeout(() => {
      btnSave.textContent = '저장';
      btnSave.disabled = false;
      window.close();
    }, 500);
  } catch (err) {
    console.error(err);
    alert('저장에 실패했습니다.');
    btnSave.textContent = '저장';
    btnSave.disabled = false;
  }
}

btnClose.addEventListener('click', () => window.close());
btnSave.addEventListener('click', save);

// Init
load();
