# ComfyUI Dynamic Sigmas

[English](README.md) | [한국어](README.ko.md)

ComfyUI에서 사용자 지정 시그마 스케줄을 생성·변형·확인·결합하고 다른 노드에서 재사용할 수 있는 도구입니다. `MODEL`을 연결하지 않아도 모델 계열별 프로필을 실용적인 시작점으로 사용할 수 있으며, 만들어진 스케줄은 언제든 직접 수정할 수 있습니다.

노드 검색창에 `cozdx1`을 입력하면 네 개의 노드를 모두 찾을 수 있습니다.

<p align="center">
  <img src="docs/images/dynamic-sigma-scheduler.png" width="900" alt="Illustrious SDXL과 WAN 프로필을 사용한 Dynamic Sigma Scheduler">
</p>

<p align="center"><sub>어두운 편집기의 Illustrious/SDXL 프로필과 밝은 편집기의 WAN 프로필</sub></p>

## v1.1.0 주요 변경 사항

- Illustrious/SDXL, Anima, WAN, LTXV, Z-Image, Qwen-Image, Flux2, Krea2, Custom 프로필
- `beta57`, `bong_tangent`를 포함한 11개 스케줄러의 실시간 미리보기
- 편집 가능한 그래프 양 끝점과 개별 스텝, 곡선 변형, 강도 조절식 단조 스무딩
- 450×300부터 1200×800까지 선택할 수 있고 해상도에 맞춰 스타일이 조절되는 Graph Sigmas
- 호환 Detailer와 샘플러 노드에서 사용할 수 있는 간결한 `SIGMAS` → `SCHEDULER_FUNC` 브릿지
- 한국어 번역·인앱 문서와 v1.0.x 워크플로 마이그레이션

## 빠른 시작

1. **[cozdx1] Dynamic Sigma Scheduler**를 추가합니다.
2. 모델 프로필과 스케줄러, 스텝 수를 선택합니다.
3. 양 끝값과 곡선 형태를 조절하거나 그래프를 직접 편집합니다.
4. `sigmas`를 호환 샘플러, Graph Sigmas, Concat Sigmas 또는 Sigmas to Scheduler Func에 연결합니다.

프로필은 모델 자동 감지 기능이 아니라 시작값을 제공하는 기능입니다. 사용 중인 모델과 샘플러, 워크플로에 적합한 시그마 범위를 확인해 주세요.

## 노드

### [cozdx1] Dynamic Sigma Scheduler

`SIGMAS` 텐서를 생성하며, 큐를 실행하기 전에도 변경 사항을 그래프에 즉시 반영합니다. 시작점과 끝점을 모두 포함하므로 항상 `steps + 1`개의 값을 출력합니다.

#### 모델 프로필

| 프로필 | Sampling 계열 | 기본 shift | 기본 시작값 |
|---|---|---:|---:|
| `illustrious / sdxl` | SDXL discrete | — | `15.0` |
| `anima` | Discrete Flow | `3.0` | `1.0` |
| `wan` | Discrete Flow | `8.0` | `1.0` |
| `ltxv` | Flux | `2.37` | `1.0` |
| `z-image` | Discrete Flow | `3.0` | `1.0` |
| `qwen-image` | Flux | `1.15` | `1.0` |
| `flux2` | Flux | `2.02` | `1.0` |
| `krea2` | Flux | `1.15` | `1.0` |
| `custom` | 수동 | — | 현재 값 유지 |

프로필을 변경하면 해당 Sampling 계열과 기본 shift·양 끝값이 선택됩니다. 현재 값을 유지하면서 스케줄을 직접 구성하려면 `custom`을 선택하세요. Illustrious/SDXL과 Custom에서는 flow shift가 비활성화됩니다.

#### 지원 스케줄러

`simple`, `sgm_uniform`, `karras`, `exponential`, `ddim_uniform`, `beta`, `beta57`, `normal`, `linear_quadratic`, `kl_optimal`, `bong_tangent`

#### 곡선 조절

- `sigma_start` / `sigma_end`: 첫 번째 값과 마지막 값을 지정합니다. 여러 스케줄을 연결할 때는 중간값을 양 끝점으로 사용할 수 있습니다.
- `curve_factor`: 양수이면 높은 시그마를 더 오래 유지하고, 음수이면 앞부분에서 더 빠르게 낮아집니다.
- `smooth_strength`: 수동으로 편집한 구간을 선형 보간(`0`)에서 단조 cubic 보간(`1`)까지 혼합합니다. 단조로 배치된 조절점 사이에 새로운 상승 구간을 만들지 않습니다.
- `show_steps`: 모든 시그마 값을 소수점 여섯 자리의 편집 가능한 위젯으로 표시합니다. 각 위젯은 입력으로 변환할 수도 있습니다.
- `black_theme`: 편집 그래프의 테마만 전환합니다.
- **Generate Curve**: 수동 편집 내용을 지우고 현재 설정으로 곡선을 다시 생성합니다.
- **Reset Profile**: 곡선과 함께 선택한 프로필의 기본 shift와 양 끝값을 복원합니다.

<p align="center">
  <img src="docs/images/curve-factor-comparison.png" width="900" alt="음수와 양수 curve factor 비교">
</p>

<p align="center"><sub>음수와 양수 <code>curve_factor</code>는 곡선을 서로 반대 방향으로 변형합니다.</sub></p>

<p align="center">
  <img src="docs/images/smooth-strength-comparison.png" width="900" alt="smooth strength 0과 1 비교">
</p>

<p align="center"><sub><code>smooth_strength</code>는 수동 곡선을 선형 보간에서 단조 cubic 보간으로 혼합합니다.</sub></p>

#### 수동 편집

그래프의 빈 곳을 클릭하면 조절점을 추가할 수 있으며, 드래그하여 곡선을 변형할 수 있습니다. 사용자 지정 점을 Shift+클릭하면 삭제됩니다. 그래프의 첫 점과 마지막 점은 `sigma_start`, `sigma_end`와 동기화됩니다.

| 그래프 직접 편집 | 개별 스텝 값 편집 |
|:---:|:---:|
| <img src="docs/images/manual-curve-editing.png" width="350" alt="시그마 곡선 수동 편집"> | <a href="docs/images/editable-step-values.png"><img src="docs/images/editable-step-values.png" width="250" alt="편집 가능한 개별 시그마 값"></a> |
| 조절점을 추가하고 드래그합니다. | `show_steps`를 켜 정확한 값을 편집합니다. 클릭하면 원본 크기로 볼 수 있습니다. |

출력 스케줄은 1차원 `float32` 텐서입니다.

### [cozdx1] Graph Sigmas

연결된 각 시그마 스케줄을 ComfyUI `IMAGE`로 렌더링합니다. `input_count`를 늘리면 같은 수의 `SIGMAS` 입력과 `IMAGE` 출력이 추가됩니다.

<p align="center">
  <img src="docs/images/graph-sigmas-node.png" width="360" alt="Graph Sigmas 노드">
</p>

- `black_theme`: 어두운 그래프와 밝은 그래프를 전환합니다.
- `preview_resolution`: Compact (450×300), Default (600×400), Large (900×600), High (1200×800) 중에서 선택합니다.
- 문자, 선, 점과 여백은 선택한 해상도에 맞춰 조절됩니다. 기존 워크플로는 600×400 기본값을 유지합니다.

<p align="center">
  <img src="docs/images/graph-sigmas-preview.png" width="1200" alt="Dynamic Sigma Scheduler를 Graph Sigmas 및 Preview Image에 연결한 모습">
</p>

### [cozdx1] Concat Sigmas

연결된 여러 스케줄을 번호 순서대로 결합합니다. `input_count`를 늘리면 입력이 추가됩니다.

<p align="center">
  <img src="docs/images/concat-sigmas-node.png" width="345" alt="Concat Sigmas 노드">
</p>

공통 경계값의 중복을 방지하기 위해 마지막 스케줄을 제외한 각 스케줄의 마지막 값을 제거합니다. 예를 들어 `[1.0, 0.5]` 다음에 `[0.5, 0.0]`을 연결하면 `[1.0, 0.5, 0.0]`이 됩니다.

<p align="center">
  <img src="docs/images/concat-sigmas-example.png" width="1400" alt="두 시그마 스케줄을 하나로 결합한 모습">
</p>

<p align="center"><sub>Concat Sigmas로 여러 시그마 시퀀스를 하나의 스케줄로 연결할 수 있습니다.</sub></p>

Concat Sigmas는 입력값을 변경하거나 인접한 양 끝값을 강제로 일치시키지 않습니다. 연속적인 스케줄이 필요하다면 경계값을 의도에 맞게 설정해 주세요.

### [cozdx1] Sigmas to Scheduler Func

기존 `SIGMAS` 스케줄을 호환 노드에서 사용할 수 있는 호출 가능한 `SCHEDULER_FUNC`로 변환합니다.

```text
Dynamic Sigma Scheduler → Sigmas to Scheduler Func → scheduler_func_opt
```

Impact Pack의 FaceDetailer, FaceDetailer (pipe), MaskDetailer (pipe), DetailerForEach 계열을 비롯해 같은 입력 형식을 제공하는 다른 노드에 연결할 수 있습니다.

<p align="center">
  <img src="docs/images/detailer-scheduler-func.png" width="1200" alt="Sigmas to Scheduler Func를 통해 Dynamic Sigma Scheduler를 Impact Pack FaceDetailer에 연결한 모습">
</p>

- 받는 노드가 같은 스텝 수를 요청하면 원본 스케줄을 그대로 반환합니다.
- 스텝 수가 다르면 양 끝점을 유지하면서 곡선을 `steps + 1`개 값으로 선형 리샘플링합니다.
- 브릿지는 추가 스무딩을 적용하지 않습니다.
- Impact Pack에서는 연결된 `scheduler_func_opt`가 샘플링 중 Detailer의 스케줄러를 대신합니다. 화면에는 스케줄러 위젯이 남지만 선택값은 사용되지 않습니다.
- Impact Pack은 선택 사항이며, Dynamic Sigmas가 이를 불러오거나 수정하지 않습니다.

## 설치

### ComfyUI Manager

1. ComfyUI Manager를 엽니다.
2. Custom Nodes Manager에서 `ComfyUI-Dynamic-Sigmas`를 검색합니다.
3. 설치한 뒤 ComfyUI를 재시작합니다.

### 수동 설치

ComfyUI의 `custom_nodes` 폴더에서 다음 명령을 실행합니다.

```bash
git clone https://github.com/cozdx1/ComfyUI-Dynamic-Sigmas.git
cd ComfyUI-Dynamic-Sigmas
pip install -r requirements.txt
```

설치 또는 업데이트 후 ComfyUI를 재시작해 주세요.

## 업데이트

```bash
cd ComfyUI/custom_nodes/ComfyUI-Dynamic-Sigmas
git pull
pip install -r requirements.txt
```

버전별 변경 사항은 [CHANGELOG.md](CHANGELOG.md)에서 확인할 수 있습니다.

## 호환성 참고 사항

- v1.0.x에서 저장한 워크플로는 이전 곡선 데이터와 동작을 보존하면서 `custom` 모드로 불러옵니다.
- 동적 입력과 출력은 현재 ComfyUI의 서브그래프 처리에 제약이 있습니다. 노드를 서브그래프로 변환하기 전에 메인 그래프에서 필요한 개수만큼 확장해 주세요.
- 적절한 시그마 값은 모델과 샘플러마다 다릅니다. Dynamic Sigmas는 사용자 지정 스케줄이 특정 샘플링 구성에 적합한지 검증하지 않습니다.
- Detailer 브릿지는 받는 노드가 요청한 스텝 수에 입력 곡선을 맞춥니다. 기존 Detailer 스케줄러를 교체할 때는 실제 디노이즈 범위를 확인해 주세요.

## 라이선스

[MIT License](LICENSE)
