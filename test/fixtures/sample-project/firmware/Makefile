CC = gcc
CFLAGS = -Wall -O2

all: firmware

firmware: main.o app.o
	$(CC) $(CFLAGS) -o firmware main.o app.o

main.o: main.c
	$(CC) $(CFLAGS) -c main.c

app.o: app.c
	$(CC) $(CFLAGS) -c app.c

clean:
	rm -f *.o firmware
