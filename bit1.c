#include <stdio.h>

int main(int argc, char* argv[]) {
    int a = 0;
    char *b = argv[1];

    if (b[0] >= 'a' && b[0] <= 'f') {
        a += b[0] - 'W';
        a *= 16;
    }
    else {
        a += b[0] - '0';
        a *= 16;
    }
    if (b[1] >= 'a' && b[1] <= 'f') {
        a += b[1] - 'W';
    }
    else {
        a += b[1] - '0';
    }
    if (a & 1) {
        printf("ma\n");
    }
    else {
        printf("fe\n");
    }

    return 0;
    argc++;
}
