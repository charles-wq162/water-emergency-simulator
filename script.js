"use strict";

// 가상 사용 비율과 임시 제한 점수입니다. 추후 실제 기준으로 교체할 수 있습니다.
const USAGES = [
  { key: "toilet", name: "화장실", ratio: 0.33 },
  { key: "shower", name: "샤워", ratio: 0.27 },
  { key: "laundry", name: "세탁", ratio: 0.17 },
  { key: "cleaning", name: "청소", ratio: 0.10 },
  { key: "landscaping", name: "조경", ratio: 0.13 }
];
const $ = (id) => document.getElementById(id);
const number = (value, digits = 1) => value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const hours = (value) => number(value, 2);
let currentInput = null;
let currentRecommendation = null;

// 샘플 자료만 사용합니다. ‘실제값’은 샘플 데이터에 용량이 있다는 뜻입니다.
const SAMPLE_BUILDINGS = {
  a: { name: "A기숙사", use: "기숙사", type: "기숙사", people: 200, area: 10000, capacity: 20000 },
  b: { name: "B아파트", use: "공동주택", type: "아파트", households: 300, area: 25000 },
  c: { name: "C학교", use: "학교", type: "학교", people: 500, area: 15000 }
};
// 용량·인원은 선택한 건물에서만 가져옵니다. 유효 저수량을 별도 입력값으로 저장하지 않습니다.
function estimateTankCapacity(building) {
  return building.households ? building.households * 2.5 * 100 : building.people * 40;
}

function getBuildingState() {
  const building = SAMPLE_BUILDINGS[$("sample-building").value];
  const capacity = building.capacity ?? estimateTankCapacity(building);
  const level = Number($("remaining-percent").value);
  return { ...building, capacity, level,
    people: building.people ?? building.households * 2.5,
    storage: capacity * level / 100 };
}

function updateBuildingInfo() {
  const state = getBuildingState();
  const hasActual = SAMPLE_BUILDINGS[$("sample-building").value].capacity !== undefined;
  $("building-facts").innerHTML = `<div><dt>건물 용도</dt><dd>${state.use}</dd></div><div><dt>${state.households ? "세대수" : "이용 인원"}</dt><dd>${number(state.households || state.people)}${state.households ? "세대" : "명"}</dd></div><div><dt>연면적</dt><dd>${number(state.area)}㎡</dd></div><div><dt>저수조 자료</dt><dd>${hasActual ? "실제 자료 있음" : "자료 없음 · 추정"}</dd></div>`;
  $("tank-capacity").textContent = `${number(state.capacity)} L`;
  $("capacity-badge").textContent = hasActual ? "실제값" : "추정값";
  $("capacity-badge").className = `badge ${hasActual ? "success" : "warning"}`;
  $("level-value").textContent = `${state.level}%`;
  $("effective-storage").textContent = `${number(state.storage)} L`;
  $("storage-formula").textContent = `${number(state.capacity)} L × ${state.level}% = ${number(state.storage)} L`;
  $("capacity-formula").textContent = hasActual ? "A기숙사: 샘플에 등록된 전체 용량 20,000L입니다." : state.households
    ? "B아파트 임시 추정: 300세대 × 2.5명/세대 × 100L/명 = 75,000L. 1인당 사용량 표시는 750명 기준입니다."
    : "C학교 임시 추정: 500명 × 40L/명 = 20,000L.";
}

// 진단은 기존 유지시간·추천 계산과 독립적입니다. 입력값을 임의로 보정하지 않습니다.
function diagnoseData({ capacity, level, previousLevel, observationHours, meterVolume, recentAverage }) {
  const decrease = capacity * (previousLevel - level) / 100;
  const expected = recentAverage * observationHours / 24;
  const tolerance = Math.max(50, expected * 0.2);
  const difference = Math.abs(decrease - meterVolume);
  const messages = [];
  let severity = 0;
  const report = (grade, message) => {
    severity = Math.max(severity, grade);
    messages.push(message);
  };
  if (decrease < 0) {
    report(1, "추가 급수가 없는 조건에서 수위가 상승했습니다. 급수 여부 또는 수위센서를 확인하세요.");
  } else if (difference > tolerance) {
    const severe = difference >= Math.max(decrease, meterVolume) * 0.5;
    report(severe ? 2 : 1, decrease > meterVolume
      ? "누수 또는 수위센서 이상 가능성: 계량기 사용량보다 저수조 감소량이 큽니다."
      : "계량기 또는 수위센서 이상 가능성: 계량기 사용량에 비해 저수조 감소량이 작습니다.");
  }
  const ratio = meterVolume / expected;
  if (ratio > 2) report(2, "비정상 사용량 감지: 현재 계량기 사용량이 최근 평균 예상량의 2배를 초과합니다.");
  else if (ratio > 1.5) report(1, "사용량 증가 주의: 현재 계량기 사용량이 최근 평균 예상량의 1.5배를 초과합니다.");
  if (!messages.length) messages.push("입력한 수위 변화와 사용량 사이에 규칙상 모순이 발견되지 않았습니다.");
  return { severity, status: ["정상", "주의", "이상 가능성"][severity], messages, decrease, expected, difference, ratio };
}

function updateDiagnosis() {
  const fields = ["observation-hours", "previous-level", "meter-volume", "recent-average"];
  const valid = fields.map((id) => {
    const field = $(id);
    const ok = field.value.trim() !== "" && Number.isFinite(field.valueAsNumber) && field.checkValidity();
    field.setAttribute("aria-invalid", String(!ok));
    return ok;
  }).every(Boolean);
  $("diagnosis-error").hidden = valid;
  let severity = 1;
  if (!valid) {
    $("diagnosis-error").textContent = "관측 시간·최근 평균은 0보다 크게, 시작 수위는 0~100%, 계량기 사용량은 0 이상으로 입력하세요. 각 입력 상한도 확인하세요.";
    $("diagnosis-result").innerHTML = '<div class="diagnosis-summary warning"><strong>주의 · 진단 대기</strong><p>입력값을 확인하면 진단 결과가 표시됩니다.</p></div>';
  } else {
    const state = getBuildingState();
    const result = diagnoseData({ capacity: state.capacity, level: state.level,
      previousLevel: $("previous-level").valueAsNumber,
      observationHours: $("observation-hours").valueAsNumber,
      meterVolume: $("meter-volume").valueAsNumber,
      recentAverage: $("recent-average").valueAsNumber });
    severity = result.severity;
    $("diagnosis-result").innerHTML = `<div class="diagnosis-summary ${["success", "warning", "danger"][severity]}"><span>데이터 일관성</span><strong>${result.status}</strong><ul>${result.messages.map(message => `<li>${message}</li>`).join("")}</ul></div><dl class="diagnosis-metrics"><div><dt>수위 변화 환산</dt><dd>${number(Math.abs(result.decrease))} L ${result.decrease < 0 ? "증가" : "감소"}</dd></div><div><dt>평균 기준 구간 예상량</dt><dd>${number(result.expected)} L</dd></div><div><dt>계량기와 수위 환산량 차이</dt><dd>${number(result.difference)} L</dd></div><div><dt>현재 사용량 / 평균 예상량</dt><dd>${number(result.ratio, 2)}배</dd></div></dl>`;
  }
  // 진단 등급은 수량 충족 여부와 별개입니다. 후속 단계에 확인 필요 상태만 전달합니다.
  for (const id of ["analysis-diagnosis-note", "recommendation-diagnosis-note"]) {
    $(id).hidden = severity === 0;
    $(id).textContent = valid
      ? "데이터 진단에서 확인이 필요한 항목이 있습니다. 아래 결과는 입력한 저수량과 3단계 평균 사용량을 그대로 사용한 계산값입니다."
      : "데이터 진단이 완료되지 않았습니다. 아래 계산은 기존 분석 입력값을 기준으로 계속 표시됩니다.";
  }
}

// 현재 유지시간 = 저수량 / 시간당 사용량. 입력 검증을 통과한 값만 받습니다.
function calculateDuration(storage, dailyUsage) {
  return storage / (dailyUsage / 24);
}

// 5 × 3 × 3 × 2 = 90개 조합. 화장실은 반드시 정상 유지합니다.
function generateCombinations() {
  const combinations = [];
  for (const shower of [0, 10, 20, 30, 40]) {
    for (const laundry of [0, 50, 100]) {
      for (const cleaning of [0, 50, 100]) {
        for (const landscaping of [0, 100]) {
          combinations.push({ toilet: 0, shower, laundry, cleaning, landscaping });
        }
      }
    }
  }
  return combinations;
}

function calculateRestrictionScore(plan) {
  return plan.shower / 10 + plan.laundry / 25 + plan.cleaning / 50 + plan.landscaping / 100;
}

// 반올림은 표시할 때만 수행하여 목표 충족 판정을 정확하게 유지합니다.
function evaluateCombination(plan, input) {
  const savedRatio = USAGES.reduce((sum, usage) => sum + usage.ratio * plan[usage.key] / 100, 0);
  const dailyUsage = input.daily * (1 - savedRatio);
  const duration = calculateDuration(input.storage, dailyUsage);
  return { plan, dailyUsage, saved: input.daily - dailyUsage, duration,
    meetsTarget: duration >= input.target, score: calculateRestrictionScore(plan) };
}

// 목표 충족 조합 중 제한 점수 최소, 동점이면 목표에 가장 가까운 시간 순입니다.
function selectOptimalPlan(evaluations) {
  return evaluations.filter((item) => item.meetsTarget)
    .sort((a, b) => a.score - b.score || a.duration - b.duration)[0] || null;
}

function readInputs() {
  const state = getBuildingState();
  const fields = ["daily", "target"];
  const labels = { daily: "하루 평균 물 사용량", target: "목표 유지시간" };
  let invalid = null;
  const input = { building: state.type, people: state.people, storage: state.storage, level: state.level };
  for (const id of fields) {
    const field = $(id);
    const valid = field.value.trim() !== "" && Number.isFinite(field.valueAsNumber) && field.checkValidity();
    field.setAttribute("aria-invalid", String(!valid));
    if (!valid && !invalid) invalid = labels[id];
    input[id] = field.valueAsNumber;
  }
  $("input-error").hidden = !invalid;
  if (invalid) {
    $("input-error").textContent = `${invalid} 입력값을 확인하세요. 사용량과 목표시간은 0.01 이상이어야 하며 입력 상한을 넘을 수 없습니다.`;
    return null;
  }
  return input;
}

function updateCurrentStatus(input) {
  const duration = calculateDuration(input.storage, input.daily);
  const gap = duration - input.target;
  const safe = gap >= 0;
  const requiredVolume = input.daily / 24 * input.target;
  const percent = input.storage / requiredVolume * 100;
  $("per-person").textContent = `${number(input.daily / input.people)} L/명`;
  $("required-volume").textContent = `${number(requiredVolume)} L`;
  $("tank-volume").textContent = `${number(input.storage)} L`;
  $("tank-percent").textContent = `현재 수위 ${input.level}%`;
  $("coverage-percent").textContent = `목표 대비 ${number(percent)}% 확보`;
  $("water").style.height = `${input.level}%`;
  $("tank").setAttribute("aria-label", `현재 저수량 ${number(input.storage)}리터, 수위 ${input.level}퍼센트`);
  $("current-hours").textContent = hours(duration);
  $("hourly").textContent = `${number(input.daily / 24)} L/h`;
  $("target-hours").textContent = `${hours(input.target)}시간`;
  $("gap-label").textContent = safe ? "여유 시간" : "부족 시간";
  $("gap-hours").textContent = `${hours(Math.abs(gap))}시간`;
  $("gap-hours").className = safe ? "success-text" : "warning-text";
  $("status-badge").className = `badge ${safe ? "success" : "warning"}`;
  $("status-badge").textContent = safe ? "목표 충족 · 안전" : "저수량 부족";
  $("current-alert").className = `alert ${safe ? "success" : "warning"}`;
  $("current-alert").textContent = safe ? "현재 사용량으로 목표시간을 확보할 수 있습니다." : "현재 사용량으로는 목표시간 전에 물이 소진됩니다. 절수 대응이 필요합니다.";
  $("usage-list").innerHTML = USAGES.map((usage) => `<div class="usage-row"><span class="dot"></span><span>${usage.name}</span><small>${Math.round(usage.ratio * 100)}%</small><strong>${number(input.daily * usage.ratio)} L</strong></div>`).join("");
}

function actionLabel(key, reduction) {
  if (reduction === 0) return "정상 유지";
  if (key === "landscaping" && reduction === 100) return "중단 · 100% 감축";
  return `${reduction}% 감축`;
}

function updateRecommendation(evaluations, input) {
  currentRecommendation = selectOptimalPlan(evaluations);
  $("total-count").textContent = evaluations.length;
  $("feasible-count").textContent = evaluations.filter((item) => item.meetsTarget).length;
  $("apply-recommendation").disabled = !currentRecommendation;
  if (!currentRecommendation) {
    const bestDuration = Math.max(...evaluations.map((item) => item.duration));
    $("recommendation").innerHTML = `<div class="recommendation-card unavailable"><h3>목표를 충족하는 조합이 없습니다</h3><p>허용된 최대 절수를 적용해도 <strong>${hours(bestDuration)}시간</strong> 유지할 수 있습니다.</p><p class="small">목표까지 ${hours(input.target - bestDuration)}시간 부족합니다. 추가 급수를 확보하거나 목표시간을 조정하세요.</p></div>`;
    return;
  }
  const result = currentRecommendation;
  const actions = USAGES.map((usage) => `<div><dt>${usage.name}</dt><dd class="${result.plan[usage.key] === 0 ? "normal" : ""}">${actionLabel(usage.key, result.plan[usage.key])}</dd></div>`).join("");
  $("recommendation").innerHTML = `<div class="recommendation-card"><div class="recommendation-top"><h3>추천 대응안</h3><span>✓ 최소 생활 제한</span></div><p class="recommendation-intro">${result.score === 0 ? "추가 제한 없이 목표시간을 충족합니다." : "목표시간을 충족하는 가장 낮은 제한 점수의 조합입니다."}</p><dl class="action-list">${actions}</dl><div class="recommendation-bottom"><div><span>적용 후 예상 유지시간</span><strong>${hours(result.duration)} <small>시간</small></strong></div><div class="score"><span>생활 제한 점수</span><strong>${result.score}<small>점</small></strong></div></div><p class="recommendation-stats"><b class="success-text">목표 대비 +${hours(result.duration - input.target)}시간</b><br>하루 사용량 ${number(result.dailyUsage)} L · 하루 절감량 ${number(result.saved)} L</p></div>`;
}

function updateManualScenario() {
  $("shower-value").textContent = `${$("shower").value}%`;
  $("landscaping-label").textContent = $("landscaping").checked ? "ON · 정상 유지" : "OFF · 중단";
  if (!currentInput) {
    $("manual-result").textContent = "현재 상황의 입력값을 먼저 확인하세요.";
    return;
  }
  const plan = { toilet: 0, shower: Number($("shower").value), laundry: Number($("laundry").value), cleaning: Number($("cleaning").value), landscaping: $("landscaping").checked ? 0 : 100 };
  const result = evaluateCombination(plan, currentInput);
  const gap = result.duration - currentInput.target;
  $("manual-result").innerHTML = `<div><span>수동 설정 예상 유지시간</span><strong>${hours(result.duration)}시간</strong></div><div class="${result.meetsTarget ? "success-text" : "warning-text"}"><span>${result.meetsTarget ? "✓ 목표 충족" : "! 목표 미달"}</span><span>${gap >= 0 ? "여유" : "부족"} ${hours(Math.abs(gap))}시간 · ${result.score}점</span></div><p>하루 사용량 ${number(result.dailyUsage)} L · 절감량 ${number(result.saved)} L</p>`;
}

function updateCombinationTable(evaluations, input) {
  const sorted = [...evaluations].sort((a, b) => a.score - b.score || Math.abs(a.duration - input.target) - Math.abs(b.duration - input.target));
  $("combination-rows").innerHTML = sorted.map((item) => `<tr class="${item === currentRecommendation ? "selected" : ""}"><td>${item.plan.shower}%</td><td>${item.plan.laundry}%</td><td>${item.plan.cleaning}%</td><td>${item.plan.landscaping}%</td><td>${number(item.dailyUsage)}</td><td>${number(item.saved)}</td><td>${hours(item.duration)}시간</td><td>${item.score}</td><td class="${item.meetsTarget ? "success-text" : "warning-text"}">${item.meetsTarget ? "충족" : "미달"}${item === currentRecommendation ? " · 추천" : ""}</td></tr>`).join("");
}

// 기본 입력이 바뀌면 90개 조합을 다시 평가합니다. 수동 설정은 독립적으로 유지합니다.
function updateScreen() {
  updateBuildingInfo();
  updateDiagnosis();
  currentInput = readInputs();
  $("current-results").hidden = !currentInput;
  $("usage-list").hidden = !currentInput;
  if (!currentInput) {
    currentRecommendation = null;
    $("status-badge").textContent = "입력 확인";
    $("status-badge").className = "badge warning";
    $("per-person").textContent = "—";
    $("total-count").textContent = "—";
    $("feasible-count").textContent = "—";
    $("recommendation").textContent = "올바른 입력값을 입력하면 자동 추천이 표시됩니다.";
    $("combination-rows").innerHTML = "";
    $("apply-recommendation").disabled = true;
  } else {
    const evaluations = generateCombinations().map((plan) => evaluateCombination(plan, currentInput));
    updateCurrentStatus(currentInput);
    updateRecommendation(evaluations, currentInput);
    updateCombinationTable(evaluations, currentInput);
  }
  updateManualScenario();
}

$("situation-form").addEventListener("submit", (event) => event.preventDefault());
$("diagnosis-form").addEventListener("submit", (event) => event.preventDefault());
// 모든 입력은 같은 갱신 경로를 사용하고, 선택한 건물에서 저수량을 매번 산정합니다.
for (const eventName of ["input", "change"]) {
  $("situation-form").addEventListener(eventName, updateScreen);
  $("diagnosis-form").addEventListener(eventName, updateDiagnosis);
  $("sample-building").addEventListener(eventName, updateScreen);
  $("remaining-percent").addEventListener(eventName, updateScreen);
}
for (const id of ["shower", "laundry", "cleaning", "landscaping"]) {
  $(id).addEventListener("input", updateManualScenario);
}
$("apply-recommendation").addEventListener("click", () => {
  if (!currentRecommendation) return;
  const plan = currentRecommendation.plan;
  for (const key of ["shower", "laundry", "cleaning"]) $(key).value = plan[key];
  $("landscaping").checked = plan.landscaping === 0;
  updateManualScenario();
});
$("reset").addEventListener("click", () => {
  $("situation-form").reset();
  $("diagnosis-form").reset();
  for (const key of ["shower", "laundry", "cleaning"]) $(key).value = "0";
  $("landscaping").checked = true;
  $("sample-building").value = "a";
  $("remaining-percent").value = "60";
  updateScreen();
});
updateScreen();
