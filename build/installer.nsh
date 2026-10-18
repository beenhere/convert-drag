; Adds "Convert with ConvertDrag" to the Explorer right-click menu for every
; file type, without changing any default apps. Removed again on uninstall.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\ConvertDrag" "" "Convert with ConvertDrag"
  WriteRegStr HKCU "Software\Classes\*\shell\ConvertDrag" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\*\shell\ConvertDrag\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\ConvertDrag"
!macroend
