# Dynamic Sigma Scheduler

`MODEL` 입력 없이 모델 계열별 기본값을 사용할 수 있는 편집 가능한 `SIGMAS` 스케줄을 만듭니다. 그래프는 즉시 갱신되며 시작점과 끝점을 모두 포함해 `steps + 1`개의 값을 출력합니다.

## 조작 항목

- **model_profile**: sampling 계열과 기본값을 선택합니다. Custom은 기존 수동 동작을 유지합니다.
- **scheduler**: 디노이징 스텝 배치를 선택합니다. `beta57`, `bong_tangent`도 포함합니다.
- **steps**: 디노이징 구간 수입니다.
- **shift**: 선택한 Discrete Flow 또는 Flux 계산식에 적용됩니다. SDXL과 Custom에서는 비활성화됩니다.
- **sigma_start / sigma_end**: 스케줄의 시작값과 종료값입니다.
- **curve_factor**: 양수이면 높은 값을 오래 유지하고, 음수이면 더 일찍 낮아집니다.
- **smooth_strength**: 수동 점 사이를 선형(`0`)부터 단조 cubic(`1`)까지 보간합니다.
- **show_steps**: 개별 스텝 값을 직접 편집하거나 입력으로 변환할 수 있게 표시합니다.
- **black_theme**: 편집 그래프의 테마만 변경합니다.

그래프의 빈 곳을 클릭하면 조절점이 생기며 드래그해 이동할 수 있습니다. 점을 Shift+클릭하면 삭제됩니다. 그래프 끝점 및 첫·마지막 스텝은 `sigma_start`, `sigma_end`와 동기화됩니다. **Generate Curve**는 수동 편집을 지우고 현재 설정으로 다시 계산하며, **Reset Profile**은 프로필 기본값까지 복원합니다.

출력 텐서는 `float32`입니다. 프로필은 모델 자동 감지가 아닌 편리한 시작값이므로 모델, 샘플러, 다음 노드에 맞는 범위인지 확인해 주세요.
