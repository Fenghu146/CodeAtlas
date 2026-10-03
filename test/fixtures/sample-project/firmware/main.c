#include <stdio.h>

int app_add(int a, int b);

int main(void) {
    int total = app_add(2, 3);
    printf("%d\n", total);
    return 0;
}
