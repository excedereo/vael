; Удаление файлов программы при обновлении и деинсталляции.
;
; Стандартный шаблон electron-builder сносит папку программы целиком, а в ней
; лежит modules — личные модули (память и другие), их в установщике нет.
; Поэтому удаляем всё, кроме modules.

!macro customRemoveFiles
  SetOutPath $TEMP
  FindFirst $0 $1 "$INSTDIR\*.*"
  vael_rm_loop:
    StrCmp $1 "" vael_rm_done
    StrCmp $1 "." vael_rm_next
    StrCmp $1 ".." vael_rm_next
    StrCmp $1 "modules" vael_rm_next
    IfFileExists "$INSTDIR\$1\*.*" 0 vael_rm_file
      RMDir /r "$INSTDIR\$1"
      Goto vael_rm_next
    vael_rm_file:
      Delete "$INSTDIR\$1"
  vael_rm_next:
    FindNext $0 $1
    Goto vael_rm_loop
  vael_rm_done:
  FindClose $0
  ; Пустая папка программы уйдёт сама; с модулями — останется
  RMDir $INSTDIR
!macroend
