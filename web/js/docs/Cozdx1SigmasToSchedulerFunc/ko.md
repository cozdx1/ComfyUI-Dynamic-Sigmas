# 시그마를 스케줄러 함수로

완성된 `SIGMAS` 스케줄을 호출 가능한 `SCHEDULER_FUNC`로 변환합니다.

출력을 호환 노드의 `scheduler_func_opt`에 연결하세요. Impact Pack의 FaceDetailer, FaceDetailer (pipe), MaskDetailer (pipe), DetailerForEach 계열과 같은 입력 형식을 제공하는 다른 노드에서 사용할 수 있습니다.

실제 스텝 수는 받는 노드가 결정합니다. 입력 스케줄과 요청된 스텝 수가 다르면 첫 값과 마지막 값을 유지하면서 곡선을 `steps + 1`개 값으로 선형 리샘플링합니다. 추가 스무딩은 적용하지 않습니다.

Impact Pack에 연결하면 Detailer의 `scheduler` 위젯은 화면에 남아 있지만 해당 선택값은 샘플링에 사용되지 않습니다.
